/**
 * Self-healing: when a replay breaks at a step (the button moved, a label
 * changed), replay up to that step, let the model find the new way through,
 * and splice its recording into the flow. The proposal is verified with one
 * model-free replay before it is returned.
 */
import { z } from "zod";
import { describeStep, paramValues, type Flow, type FlowRun } from "@dappdrill/core";
import type { DrillSession, Llm } from "../types.js";
import type { ReplayFn } from "./describe.js";
import { browserTools, listSteps, Recorder, settle } from "./tools.js";

export interface RepairOptions {
  replay: ReplayFn;
  signal?: AbortSignal;
  maxTurns?: number;
  /** Skip the verification replay (tests). */
  verify?: boolean;
}

export const REPAIR_SYSTEM = `You are DappDrill, fixing a recorded test flow for a web3 dApp that broke on replay. The browser is already at the state right before the failing step. Your job: do what that step (and, if needed, the following ones) meant to do, so the flow works again.

- Start with look to see the page. Then perform the intended action(s). Only record what is necessary.
- The steps you perform replace the failing step. If you also had to redo later steps, say so with resumeFromStep (the index of the first original step that should still run after yours).
- Approve wallet requests with wallet_approve when they match the intent of the flow.
- When the app is back on track, call finish_repair. If the flow cannot be fixed (feature removed, page gone, bot check), call give_up with the reason.
Finish with one or two sentences explaining what changed in the app and what you did.`;

export async function proposeRepair(
  session: DrillSession,
  llm: Llm,
  flow: Flow,
  failedRun: FlowRun,
  opts: RepairOptions,
): Promise<{ flow: Flow; explanation: string } | null> {
  const failed = failedRun.steps.find((s) => s.status === "fail");
  if (!failed) return null;
  const idx = failed.index;
  const step = flow.steps[idx];
  if (!step) return null;
  const log = (message: string, level: "info" | "warn" = "info") => session.emit({ type: "log", level, message, at: new Date().toISOString() });

  // Bring the page to the state right before the failing step.
  const upTo = await opts.replay(flow, { upToStep: idx });
  if (!upTo.ok) {
    log(`Repair: replay broke earlier at step ${upTo.failedStep}: ${upTo.error}`, "warn");
    return null;
  }
  await settle(session);

  const recorder = new Recorder(session);
  recorder.start(flow.name, flow.steps.slice(0, idx), paramValues(flow));
  let proposal: Flow | undefined;
  let gaveUp: string | undefined;

  const tools = [
    ...browserTools({ session, recorder, onBlocked: (r) => { gaveUp = `blocked: ${r}`; } }),
    {
      name: "finish_repair",
      description: "The flow is back on track. Your recorded actions replace the failing step; original steps from resumeFromStep onwards are kept.",
      schema: z.object({
        resumeFromStep: z.number().int().nonnegative().optional().describe(`Index of the first original step to keep after yours (default ${idx + 1})`),
      }),
      handler: async ({ resumeFromStep }: { resumeFromStep?: number }) => {
        const rec = recorder.end()!;
        const added = rec.steps.length - idx;
        if (added <= 0) return "You have not performed any action yet.";
        const resume = Math.max(idx + 1, Math.min(resumeFromStep ?? idx + 1, flow.steps.length));
        proposal = { ...flow, steps: [...rec.steps, ...flow.steps.slice(resume)], params: mergeParams(flow.params, rec.params) };
        return `Proposal: ${added} new step(s) replace step ${idx}${resume > idx + 1 ? ` through ${resume - 1}` : ""}. Reply with a short explanation.`;
      },
    },
    {
      name: "give_up",
      description: "The flow cannot be repaired.",
      schema: z.object({ reason: z.string() }),
      handler: async ({ reason }: { reason: string }) => {
        gaveUp = reason;
        recorder.discard();
        return "Noted.";
      },
    },
  ];

  const prompt = [
    `App: ${session.target.url}`,
    `Flow "${flow.name}" (start ${flow.startUrl}):`,
    listSteps(flow.steps, Object.fromEntries(flow.params.map((p) => [p.name, p.default]))),
    "",
    `Step ${idx} failed: ${describeStep(step)}`,
    `Error: ${failed.error ?? failedRun.reason ?? "unknown"}`,
    `The page is now at the state right before step ${idx}. Start by calling look.`,
  ].join("\n");

  const before = llm.costUsd();
  let explanation = "";
  try {
    const res = await llm.runAgent({ system: REPAIR_SYSTEM, prompt, tools, maxTurns: opts.maxTurns ?? 25, signal: opts.signal, onText: (t) => log(t.slice(0, 300)) });
    explanation = res.text;
  } finally {
    await session.emit({ type: "cost", usd: llm.costUsd() - before });
  }
  if (!proposal || gaveUp) {
    log(`Repair: no proposal (${gaveUp ?? "model did not finish"})`, "warn");
    return null;
  }
  if (opts.verify !== false) {
    const check = await opts.replay(proposal, {});
    if (!check.ok) {
      log(`Repair: proposal failed verification at step ${check.failedStep}: ${check.error}`, "warn");
      return null;
    }
    explanation = `${explanation}\n\nVerified: the repaired flow replays cleanly.`.trim();
  }
  return { flow: proposal, explanation };
}

function mergeParams(existing: Flow["params"], recorded: Flow["params"]): Flow["params"] {
  const byName = new Map(existing.map((p) => [p.name, p]));
  for (const p of recorded) if (!byName.has(p.name)) byName.set(p.name, p);
  return [...byName.values()];
}
