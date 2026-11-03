/**
 * "Record a flow from a description": the model performs what the user
 * described and the Recorder turns it into a replayable Flow. With an
 * existing flow it replays that first (fully or up to a step) and records
 * the changes from there.
 */
import { z } from "zod";
import { newId, paramValues, type Flow } from "@dappdrill/core";
import type { DrillSession, Inbox, Llm } from "../types.js";
import { LlmError } from "./llm-common.js";
import { createToolkit, inboxTool, listSteps, Recorder, settle } from "./tools.js";

/** Replays a flow without a model; provided by the runtime. `upToStep` stops before that index. */
export type ReplayFn = (
  flow: Flow,
  opts: { upToStep?: number; inputs?: Record<string, string> },
) => Promise<{ ok: boolean; failedStep?: number; error?: string }>;

export interface DescribeOptions {
  existing?: Flow;
  replay?: ReplayFn;
  signal?: AbortSignal;
  inbox?: Inbox;
  maxTurns?: number;
}

export const DESCRIBE_SYSTEM = `You are DappDrill, recording a test flow for a web3 dApp in a sandboxed browser with a test wallet (forked chain, test funds). The user describes what the flow should do; you perform it once so it can be replayed without you.

How to work:
- Navigate to where the flow starts, then call start_flow. Everything after that is recorded, so do not include exploration clicks; look around first if needed.
- Perform the steps exactly as a user would. Use small amounts unless the description says otherwise. Approve wallet requests with wallet_approve after checking they match what you did (reject with wallet_reject only if the description asks for it).
- When the app shows the result, call end_flow with a name and a short text visible on the page that proves success.
- Connection and network switches are approved automatically; you still need to click the app's Connect button if it is not connected.
- Never leave the app's origin. If a CAPTCHA or bot check appears, call report_blocked and stop.
- If the flow cannot be completed, call end_flow with success=false and explain why in your final reply.
Finish with one or two sentences on what the flow does and anything notable.`;

export async function recordDescribedFlow(
  session: DrillSession,
  llm: Llm,
  description: string,
  opts: DescribeOptions = {},
): Promise<{ flow: Flow; explanation: string }> {
  const recorder = new Recorder(session);
  const { existing, replay } = opts;
  let result: Flow | undefined;
  let failure: string | undefined;
  const log = (message: string, level: "info" | "warn" = "info") => session.emit({ type: "log", level, message, at: new Date().toISOString() });

  const kit = createToolkit({ session, recorder, inbox: opts.inbox, onBlocked: (r) => { failure = `blocked: ${r}`; } });
  const tools = [
    ...kit.tools,
    ...(opts.inbox ? [inboxTool(opts.inbox)] : []),
    {
      name: "start_flow",
      description: "Start recording from the current page. Call right before the first step of the flow.",
      schema: z.object({}),
      handler: async () => {
        recorder.start(existing?.name ?? "described flow");
        return `Recording from ${session.page.url()}.`;
      },
    },
    ...(existing && replay
      ? [{
          name: "replay_existing",
          description: `Replay the existing flow's steps (all, or the first upToStep) and continue recording from there. The replayed steps are kept in the new flow.`,
          schema: z.object({ upToStep: z.number().int().nonnegative().optional().describe("Stop before this step index; omit to replay everything") }),
          handler: async ({ upToStep }: { upToStep?: number }) => {
            const upTo = Math.min(upToStep ?? existing.steps.length, existing.steps.length);
            const res = await replay(existing, { upToStep: upTo });
            const kept = res.ok ? upTo : (res.failedStep ?? 0);
            recorder.start(existing.name, existing.steps.slice(0, kept), paramValues(existing));
            return kit.after(
              res.ok
                ? `Replayed ${kept} steps. Recording continues from here.`
                : `Replay failed at step ${res.failedStep}: ${res.error}. Kept the first ${kept} steps; record the rest yourself.`,
            );
          },
        }]
      : []),
    {
      name: "end_flow",
      description: "Finish recording. success=true needs a name and a short text visible on the page that proves the flow worked.",
      schema: z.object({ success: z.boolean(), name: z.string().optional(), successText: z.string().optional(), reason: z.string().optional() }),
      handler: async ({ success, name, successText, reason }: { success: boolean; name?: string; successText?: string; reason?: string }) => {
        if (!recorder.recording()) return "Nothing is being recorded; call start_flow first.";
        if (!success) {
          recorder.discard();
          failure = reason ?? "the model could not complete the flow";
          return "Discarded.";
        }
        if (successText) {
          await settle(session);
          const visible = await session.page.getByText(successText, { exact: false }).first().isVisible().catch(() => false);
          if (!visible) return `"${successText}" is not visible right now. Pick text that is actually on the page.`;
          recorder.add({ kind: "expect", assert: { type: "visible", text: successText } });
        }
        const rec = recorder.end()!;
        if (!rec.steps.some((s) => s.kind !== "expect")) return "The flow has no actions; call start_flow and perform the steps.";
        const params = mergeParams(existing?.params ?? [], rec.params);
        result = {
          id: existing?.id ?? newId("flow"),
          name: name ?? existing?.name ?? "Described flow",
          origin: "described",
          startUrl: rec.startUrl,
          params,
          steps: rec.steps,
          chainId: rec.chainId,
        };
        log(`Recorded "${result.name}" (${result.steps.length} steps)`);
        return `Saved "${result.name}" with ${result.steps.length} steps. Reply with a short explanation.`;
      },
    },
  ];

  const prompt = [
    `App: ${session.target.url}`,
    `Wallet: ${session.wallet.address()} on chain ${session.wallet.chainId()}.`,
    `Flow to record: ${description}`,
    existing
      ? `\nAn existing flow "${existing.name}" (start ${existing.startUrl}) has these steps:\n${listSteps(existing.steps)}\n${
          replay ? "Call replay_existing first (all steps, or up to the step you want to change), then record the changes." : "Re-record it with the changes described."
        }`
      : "",
    "Start by calling look.",
  ].filter(Boolean).join("\n");

  const before = llm.costUsd();
  let explanation = "";
  try {
    const res = await llm.runAgent({ system: DESCRIBE_SYSTEM, prompt, tools, maxTurns: opts.maxTurns ?? 40, signal: opts.signal, onText: (t) => log(t.slice(0, 300)) });
    explanation = res.text;
  } finally {
    await session.emit({ type: "cost", usd: llm.costUsd() - before });
  }
  if (!result) throw new LlmError("invalid_output", failure ?? "The model finished without recording the flow");
  return { flow: result, explanation };
}

function mergeParams(existing: Flow["params"], recorded: Flow["params"]): Flow["params"] {
  const byName = new Map(existing.map((p) => [p.name, p]));
  for (const p of recorded) if (!byName.has(p.name)) byName.set(p.name, p);
  return [...byName.values()];
}
