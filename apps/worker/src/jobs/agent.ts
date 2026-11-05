import { and, asc, eq, lt, ne } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { OFFERED_CONDITIONS, conditionInfo, keepActions, newId, walletUse, type EdgeCaseId } from "@dappdrill/core";
import {
  addConditions,
  specOf,
  agentMessages,
  flows,
  flowsWithTests,
  latestRuns,
  nextPosition,
  queueRuns,
  tests,
  touched,
  type AgentLink,
  type Db,
} from "@dappdrill/db";
import type { AgentTool } from "@dappdrill/engine";
import type { Engine } from "@dappdrill/engine/fake";
import { artifactsDir } from "../artifacts.js";
import { logger } from "../log.js";
import { QUEUES, type DraftJob, type TestsJob } from "../queues.js";
import { buildTarget, loadApp, type AppRow } from "../target.js";
import { throttle } from "./stop.js";

type MessageRow = typeof agentMessages.$inferSelect;
const CONDITION_IDS = OFFERED_CONDITIONS.map((c) => c.id) as [EdgeCaseId, ...EdgeCaseId[]];

/** agent.reply: answer the developer's latest message in the side panel, acting on the app's tests. */
export async function runAgentReply(db: Db, engine: Engine, boss: PgBoss, messageId: string, signal: AbortSignal): Promise<void> {
  const log = logger(`agent ${messageId}`);
  const [reply] = await db.select().from(agentMessages).where(eq(agentMessages.id, messageId));
  if (!reply || reply.status !== "pending") return log.warn("no pending reply; skipping");
  const app = await loadApp(db, reply.appId);
  const earlier = await db
    .select()
    .from(agentMessages)
    .where(and(eq(agentMessages.appId, app.id), lt(agentMessages.createdAt, reply.createdAt), ne(agentMessages.status, "pending")))
    .orderBy(asc(agentMessages.createdAt));
  const question = earlier.findLast((m) => m.role === "user");
  const update = (patch: Partial<MessageRow>) => db.update(agentMessages).set(patch).where(eq(agentMessages.id, messageId));
  if (!question) return void (await update({ status: "failed", text: "There was no question to answer." }));

  const links: AgentLink[] = [];
  const stream = throttle(400, (text: string) => update({ text }));
  try {
    const { text } = await engine.chatTurn(
      await buildTarget(db, app, "tests"),
      {
        message: question.text,
        history: earlier.filter((m) => m !== question && m.status === "done").slice(-12).map((m) => ({ role: m.role, text: m.text })),
        map: app.map ?? undefined,
        context: await describeContext(db, question.context),
        tools: testTools(db, boss, app, links),
        signal,
        onText: (t) => stream.push(t),
      },
      { artifactsDir: artifactsDir("agent", messageId) },
    );
    await stream.flush();
    await update({ status: "done", text: text || "Done.", links });
  } catch (e) {
    await stream.flush();
    log.error("failed", e);
    await update({ status: "failed", text: "Something went wrong answering that. Try again.", links });
  }
}

async function describeContext(db: Db, ctx: MessageRow["context"]): Promise<string | undefined> {
  if (ctx.testId) {
    const [t] = await db.select({ name: tests.name, flow: flows.name }).from(tests).innerJoin(flows, eq(flows.id, tests.flowId)).where(eq(tests.id, ctx.testId));
    if (t) return `viewing test “${t.name}” (${ctx.testId}) in flow “${t.flow}”`;
  }
  if (ctx.flowId) {
    const [f] = await db.select({ name: flows.name }).from(flows).where(eq(flows.id, ctx.flowId));
    if (f) return `viewing flow “${f.name}” (${ctx.flowId})`;
  }
  return "on the app's flows page";
}

/** What the assistant can do with the app's tests. Changes are collected as links for the panel. */
function testTools(db: Db, boss: PgBoss, app: AppRow, links: AgentLink[]): AgentTool[] {
  const testLink = (id: string, label: string) => links.push({ label, href: `/apps/${app.id}/tests/${id}` });
  const own = async (testId: string) => {
    const [t] = await db.select().from(tests).where(and(eq(tests.id, testId), eq(tests.appId, app.id)));
    if (!t) throw new Error(`No test ${testId} in this app. Use list_tests for ids.`);
    return t;
  };
  const run = async (testIds: string[]) => {
    const batchId = await queueRuns(db, app.id, testIds, "agent");
    if (batchId) await boss.send(QUEUES.tests, { batchId } satisfies TestsJob);
  };
  const draft = async (row: typeof tests.$inferInsert & { drafting: string }) => {
    await db.insert(tests).values(row);
    await boss.send(QUEUES.draft, { testId: row.id } satisfies DraftJob);
    testLink(row.id, row.name);
  };

  return [
    {
      name: "list_tests",
      description: "The app's flows (with goal) and their tests with ids and the latest result. Condition rows are listed under their test.",
      schema: z.object({}),
      handler: async () => {
        const all = await flowsWithTests(db, app.id);
        const last = await latestRuns(db, all.flatMap((f) => f.tests.map((t) => t.id)));
        if (all.length === 0) return "No flows yet.";
        return all
          .map((f) =>
            [
              `${f.name} (flow ${f.id})${f.goal ? `: ${f.goal}` : ""}${f.tests.length === 0 ? " — not tested" : ""}`,
              ...f.tests.map((t) => `- ${specOf(t).name} [${t.id}]${t.condition ? ` condition of ${t.baseId}` : ""}: ${last.get(t.id)?.status ?? "never run"}`),
            ].join("\n"),
          )
          .join("\n\n");
      },
    },
    {
      name: "get_test",
      description: "A test's goal, expected result, steps and its latest run.",
      schema: z.object({ testId: z.string() }),
      handler: async ({ testId }) => {
        const t = await own(testId);
        const spec = specOf(t);
        const r = (await latestRuns(db, [testId])).get(testId);
        return [
          `${spec.name} [${t.id}]${t.condition ? ` — runs ${t.baseId}'s steps under the condition: ${conditionInfo(t.condition).name}` : ""}`,
          `Goal: ${t.goal}`,
          `Expected: ${spec.expected}`,
          `Starts at: ${t.startPath}`,
          t.steps.length ? `Steps:\n${t.steps.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}` : "",
          r ? `Latest run: ${r.status}${r.result?.failure ? `. ${r.result.failure}` : ""}` : "Never run.",
          ...(r?.result?.steps ?? []).flatMap((s, i) => (s.note ? [`  step ${i + 1}: ${s.note}`] : [])),
        ].filter(Boolean).join("\n");
      },
    },
    {
      name: "create_test",
      description: "Write a new test from a sentence and run it. Uses an existing flow by name, or makes a new flow.",
      schema: z.object({ flow: z.string().describe("Flow name, e.g. 'Trade perps'"), request: z.string().describe("What the test should do, in the developer's words") }),
      handler: async ({ flow, request }) => {
        const flows_ = await db.select().from(flows).where(eq(flows.appId, app.id));
        let target = flows_.find((f) => f.name.toLowerCase() === flow.toLowerCase());
        if (!target) {
          target = { id: newId("flow"), appId: app.id, name: flow, goal: null, position: await nextPosition(db, app.id), createdAt: new Date() };
          await db.insert(flows).values(target);
        }
        const flowId = target.id;
        const id = newId("test");
        await draft({ id, appId: app.id, flowId, name: request.slice(0, 60), goal: request, expected: "", steps: [], drafting: request, position: await nextPosition(db, app.id, flowId) });
        return `Writing it now as ${id} in “${target.name}”; it runs when written.`;
      },
    },
    {
      name: "duplicate_test",
      description: "Copy a test with a change, e.g. 'the same but a limit sell'. The copy is written, then run.",
      schema: z.object({ testId: z.string(), change: z.string() }),
      handler: async ({ testId, change }) => {
        const base = await own(testId);
        if (base.baseId) return "That is a condition row; duplicate its test instead.";
        const id = newId("test");
        await draft({ id, appId: app.id, flowId: base.flowId, name: `${base.name} (copy)`, goal: base.goal, expected: base.expected, startPath: base.startPath, steps: base.steps, forkedFrom: base.id, drafting: change, position: base.position });
        return `Duplicating “${base.name}” as ${id}; it runs when written.`;
      },
    },
    {
      name: "update_test",
      description: "Change a test's name, goal, expected result or steps. Steps replace the whole list. Condition rows can't be edited: they read from their test and the condition.",
      schema: z.object({
        testId: z.string(),
        name: z.string().optional(),
        goal: z.string().optional(),
        expected: z.string().optional(),
        steps: z.array(z.string()).optional().describe("Short imperative steps, 3-7 words each"),
      }),
      handler: async ({ testId, name, goal, expected, steps }) => {
        const t = await own(testId);
        if (t.condition) return "That is a condition row; its name, goal, expected result and steps come from its test and the condition. Edit the test instead.";
        await db
          .update(tests)
          .set({
            ...(name ? { name } : {}),
            ...(goal ? { goal } : {}),
            ...(expected ? { expected, proof: null } : {}),
            ...(steps ? { steps: keepActions(steps, t.steps) } : {}),
            ...touched(),
          })
          .where(eq(tests.id, testId));
        testLink(testId, name ?? t.name);
        return "Updated.";
      },
    },
    {
      name: "add_conditions",
      description: `Add conditions to a test (its steps run under each: a rejected signature, a slow RPC…) and run them. Only for tests that have asked the wallet to sign on a run. Conditions: ${OFFERED_CONDITIONS.map((c) => `${c.id} (${c.name})`).join(", ")}. Leave out for the usual ones.`,
      schema: z.object({ testId: z.string(), conditions: z.array(z.enum(CONDITION_IDS)).optional() }),
      handler: async ({ testId, conditions }) => {
        const base = await own(testId);
        if (base.baseId) return "That is a condition row; add conditions to its test instead.";
        const use = walletUse(base.steps);
        if (use === "none") return "That test never asks the wallet to sign, so conditions have nothing to change.";
        if (use === "unknown") return "No run of that test has reached the wallet yet. Conditions unlock once one does.";
        const ids = await addConditions(db, testId, conditions ?? OFFERED_CONDITIONS.filter((c) => c.default).map((c) => c.id));
        if (ids.length === 0) return "It already has those.";
        await run(ids);
        testLink(testId, base.name);
        return `Added ${ids.length} and started them: ${ids.join(", ")}.`;
      },
    },
    {
      name: "run_tests",
      description: "Run tests now. Give test ids, or a flow id to run all its tests.",
      schema: z.object({ testIds: z.array(z.string()).optional(), flowId: z.string().optional() }),
      handler: async ({ testIds, flowId }) => {
        const ids = flowId ? (await db.select({ id: tests.id }).from(tests).where(and(eq(tests.flowId, flowId), eq(tests.appId, app.id)))).map((t) => t.id) : (testIds ?? []);
        if (ids.length === 0) return "No tests given.";
        await run(ids);
        links.push({ label: ids.length === 1 ? "Running 1 test" : `Running ${ids.length} tests`, href: `/apps/${app.id}` });
        return `Started ${ids.length}.`;
      },
    },
  ];
}
