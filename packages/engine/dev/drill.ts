/**
 * One stage of a pass at a time, for working on the engine without waiting for a whole pass.
 *
 *   pnpm drill look <url>                       look around only (about two minutes)
 *   pnpm drill setup <url>                      check the setup from a clean start
 *   pnpm drill explore <url> --feature swap     one feature's explorer and its proofs
 *   pnpm drill pass <url>                       the whole pass
 *   pnpm drill run <url> [--only text]          run the saved tests again
 *   pnpm drill show <url>                       what is saved for this app
 *
 * Each stage starts from what the earlier ones saved under .drill/<host>/: the test accounts
 * (the same keys every time, so an app that signs users up sees one user), the look, the setup
 * with its recorded actions, and the tests. `--fresh` forgets the look and the setup. `--inbox`
 * makes a test inbox once, for an app that signs in with a code sent by email.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { generatePrivateKey } from "viem/accounts";
import { AppSetup, DrillTarget, newId, type ChainConfig, type DrillEventSink, type ExploreState, type ExploreSuggestion, type TestSpec, type TestStep } from "@dappdrill/core";
import { explore, runTests } from "../src/api.js";
import { createInboxAccount, type InboxCredentials } from "../src/inbox/index.js";
import type { Found } from "../src/explore/look.js";

interface SavedTest {
  spec: TestSpec;
  feature: string;
  status: "proved" | "draft";
  note?: string;
  conditions: string[];
}

const { positionals, values: flags } = parseArgs({
  allowPositionals: true,
  options: {
    feature: { type: "string", multiple: true },
    minutes: { type: "string" },
    hints: { type: "string" },
    chain: { type: "string", multiple: true },
    only: { type: "string" },
    slots: { type: "string" },
    fresh: { type: "boolean" },
    headed: { type: "boolean" },
    drafts: { type: "boolean" },
    "keep-wallet": { type: "boolean" },
    inbox: { type: "boolean" },
  },
});
const [command, url] = positionals;
if (!command || !url) {
  console.error("usage: pnpm drill <look|setup|explore|pass|run|show> <url> [--feature name]… [--minutes n] [--hints text] [--chain id[=rpc]]… [--only text] [--fresh] [--headed] [--keep-wallet] [--inbox]");
  process.exit(2);
}

const dir = path.resolve(import.meta.dirname, "../../../.drill", new URL(url).host);
const file = (name: string) => path.join(dir, name);
const load = async <T>(name: string): Promise<T | undefined> => readFile(file(name), "utf8").then((s) => JSON.parse(s) as T, () => undefined);
const save = (name: string, value: unknown) => writeFile(file(name), JSON.stringify(value, null, 2));

await mkdir(dir, { recursive: true });
if (flags.fresh) await Promise.all(["look.json", "setup.json"].map((f) => rm(file(f), { force: true })));

const kept = (await load<{ accounts: { A: string; B: string }; chains: ChainConfig[]; hints?: string; tokens?: DrillTarget["tokens"]; inbox?: InboxCredentials }>("target.json")) ?? { accounts: { A: generatePrivateKey(), B: generatePrivateKey() }, chains: [] };
// A new look decides again what the wallet starts with.
if (flags.fresh || command === "look") kept.tokens = [];
if (flags.hints) kept.hints = flags.hints;
// For an app that signs in with a code sent by email: one disposable inbox, kept like the accounts.
if (flags.inbox && !kept.inbox) kept.inbox = await createInboxAccount();
await save("target.json", kept);

const target = DrillTarget.parse({
  url,
  accounts: kept.accounts,
  learnedChains: kept.chains,
  tokens: kept.tokens,
  chains: (flags.chain ?? []).map((c) => {
    const [id, rpcUrl] = c.split("=");
    return { id: Number(id), rpcUrl, mode: "fork" };
  }),
  // A chain that can't be forked gets a new wallet on every run unless there is a key to keep. Where each
  // new wallet becomes an account on the app's side (a Privy user), --keep-wallet uses the saved one instead.
  liveKey: process.env.DAPPDRILL_LIVE_KEY ?? (flags["keep-wallet"] ? kept.accounts.A : undefined),
  inbox: kept.inbox,
});

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const artifactsDir = file(`artifacts/${command}-${stamp}`);
const started = Date.now();
const clock = () => `${String(Math.floor((Date.now() - started) / 60_000)).padStart(2, "0")}:${String(Math.floor(((Date.now() - started) % 60_000) / 1000)).padStart(2, "0")}`;

/** Prints the feed as it grows, and what each explorer is doing when it changes. */
function printer(): DrillEventSink {
  const seen = new Set<string>();
  const doing = new Map<string, string>();
  return (e) => {
    if (e.type === "log" && (e.level !== "info" || process.env.STAGE_VERBOSE)) console.log(`${clock()}  ${e.level === "info" ? "log   " : "!     "} ${e.message}`);
    if (e.type !== "explore") return;
    for (const line of e.state.feed) {
      const key = `${line.at}|${line.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`${clock()}  ${line.kind.padEnd(6)} ${line.explorerId ? `[${line.explorerId.slice(-4)}] ` : ""}${line.text}`);
    }
    if (!process.env.STAGE_VERBOSE) return;
    for (const x of e.state.explorers) {
      if (!x.doing || doing.get(x.id) === x.doing) continue;
      doing.set(x.id, x.doing);
      console.log(`${clock()}  …      [${x.id.slice(-4)}] ${x.doing}`);
    }
  };
}

function summary(state: ExploreState, costUsd: number): void {
  const line = (s: string) => console.log(s);
  line(`\n── ${command} · ${clock()} · $${costUsd.toFixed(2)} ${state.costs ? JSON.stringify(state.costs.stage) : ""}`);
  if (state.stopped) line(`STOPPED: ${state.stopped}`);
  line(`\nFeatures (${state.features.length})`);
  for (const f of state.features) line(`  ${f.tier.padEnd(10)} ${f.name}  ${f.startPath}  — ${f.why}`);
  line(`\nSuggested tests (${state.suggested.length})`);
  for (const s of state.suggested) line(`  ${s.status.padEnd(9)} [${s.feature}] ${s.draft.name}${s.note ? `\n            ↳ ${s.note}` : ""}`);
  const by = (status: string) => state.checks.filter((c) => c.status === status).length;
  line(`\nChecks: ${by("pass")} pass, ${by("fail")} fail, ${by("error")} error`);
  for (const c of state.checks) line(`  ${c.status.padEnd(5)} ${c.variation.padEnd(10)} [${c.feature}] ${c.name} (${c.assert.kind}${c.assert.value ? ` "${c.assert.value}"` : ""})${c.status === "pass" ? "" : `\n            ↳ ${c.evidence}`}`);
  if (state.bugs.length) line(`\nBugs (${state.bugs.length})`);
  for (const b of state.bugs) line(`  ${b.status.padEnd(14)} ${b.severity.padEnd(8)} [${b.feature}] ${b.name}\n            ↳ ${b.reasoning ?? b.actual}`);
  if (state.gaps.length) line(`\nGaps (${state.gaps.length})`);
  for (const g of state.gaps) line(`  [${g.feature}] ${g.what} — ${g.why}`);
  for (const x of state.explorers.filter((x) => x.error)) line(`\nexplorer ${x.title}: ${x.error}`);
}

async function pass(until?: "look" | "setup"): Promise<void> {
  const found = command === "look" ? undefined : await load<Found>("look.json");
  if (command !== "look" && command !== "pass" && !found) throw new Error("No saved look. Run `pnpm drill look` first.");
  const setup = await load<AppSetup>("setup.json");
  const tests = (await load<SavedTest[]>("tests.json")) ?? [];
  const names = found?.features.map((f) => f.name) ?? [];
  const only = flags.feature?.map((want) => {
    const hit = names.find((n) => n.toLowerCase().includes(want.toLowerCase()));
    if (!hit) throw new Error(`No feature matches "${want}". Features: ${names.join(", ")}`);
    return hit;
  });

  const out = await explore(
    target,
    {
      artifactsDir,
      budgetMinutes: Number(flags.minutes ?? (command === "pass" ? 12 : 5)),
      hints: kept.hints,
      setup: setup && AppSetup.parse(setup),
      tests: tests.filter((t) => t.status === "proved").map((t) => ({ id: t.spec.id, name: t.spec.name, goal: t.spec.goal })),
      slots: flags.slots ? Number(flags.slots) : undefined,
      headless: !flags.headed,
      found,
      only,
      until,
    },
    {
      onMap: async (_map, proposed) => {
        if (proposed && !setup) await save("setup.json", proposed);
      },
      onSetupSteps: async (steps: TestStep[], reset?: TestStep[]) => {
        const now = (await load<AppSetup>("setup.json")) ?? setup;
        if (now) await save("setup.json", { ...now, steps, ...(reset ? { reset } : {}) });
      },
      onTest: async (s: ExploreSuggestion) => {
        if (s.status !== "proved" && s.status !== "draft") return;
        const steps = s.steps ?? s.draft.steps.map((text) => ({ text }));
        const after = s.after ?? s.draft.after?.map((text) => ({ text }));
        const others = tests.filter((t) => t.spec.name !== s.draft.name);
        tests.splice(0, tests.length, ...others, {
          spec: { id: newId("test"), name: s.draft.name, goal: s.draft.goal, expected: s.draft.expected, startPath: s.draft.startPath, steps, ...(after?.length ? { after } : {}) },
          feature: s.feature,
          status: s.status,
          note: s.note,
          conditions: s.conditions,
        });
        await save("tests.json", tests);
      },
    },
    printer(),
  );
  if (out.found) await save("look.json", out.found);
  await save("target.json", { ...kept, chains: out.chains.length ? out.chains : kept.chains, tokens: out.tokens });
  if (out.tokens.length) console.log(`\nThe test wallet starts with: ${out.tokens.map((t) => `${t.amount} ${t.symbol ?? t.address}`).join(", ")}`);
  await save(`state-${command}.json`, out.state);
  summary(out.state, out.costUsd);
  if (out.found && (command === "look" || command === "pass")) {
    console.log(`\nPages (${out.found.pages.length})`);
    for (const p of out.found.pages) console.log(`  ${JSON.stringify(p)}`);
    if (out.found.setup) console.log(`\nSetup (${out.found.setup.when}): ${out.found.setup.steps.join(" → ")}`);
  }
}

async function run(): Promise<void> {
  const all = (await load<SavedTest[]>("tests.json")) ?? [];
  const tests = all.filter((t) => (flags.drafts || t.status === "proved") && (!flags.only || t.spec.name.toLowerCase().includes(flags.only.toLowerCase())));
  if (!tests.length) throw new Error("No saved tests match.");
  const setup = await load<AppSetup>("setup.json");
  const out = await runTests(
    target,
    tests.map((t) => ({ spec: t.spec })),
    { artifactsDir, setup: setup && AppSetup.parse(setup), secondLook: false, headless: !flags.headed },
    {
      onStart: async (id) => console.log(`${clock()}  start  ${tests.find((t) => t.spec.id === id)?.spec.name}`),
      onDone: async (o) => {
        const t = tests.find((x) => x.spec.id === o.testId)!;
        const failed = o.result.steps.find((s) => s.status === "fail");
        console.log(`${clock()}  ${o.status.padEnd(6)} ${t.spec.name}${o.status === "pass" ? "" : `\n            ↳ ${o.result.failure ?? failed?.note ?? o.result.verdict?.reason ?? ""}`}`);
        if (o.status !== "pass") return;
        if (o.steps) t.spec.steps = o.steps;
        if (o.after) t.spec.after = o.after;
        // A draft that passes from a clean start has proved itself.
        if (t.status === "draft") Object.assign(t, { status: "proved", note: undefined });
      },
      onSetupSteps: async (steps, reset) => {
        if (setup) await save("setup.json", { ...setup, steps, ...(reset ? { reset } : {}) });
      },
    },
    printer(),
  );
  await save("tests.json", all);
  await save("state-run.json", out.outcomes);
  const passed = out.outcomes.filter((o) => o.status === "pass").length;
  console.log(`\n── run · ${clock()} · $${out.costUsd.toFixed(2)} · ${passed}/${out.outcomes.length} passed`);
}

async function show(): Promise<void> {
  const found = await load<Found>("look.json");
  const setup = await load<AppSetup>("setup.json");
  const tests = (await load<SavedTest[]>("tests.json")) ?? [];
  console.log(dir);
  console.log(`chains: ${kept.chains.map((c) => `${c.id} (${c.mode})`).join(", ") || "none learned"}`);
  if (kept.inbox) console.log(`inbox: ${kept.inbox.address}`);
  if (found) for (const f of found.features) console.log(`  ${f.tier.padEnd(10)} ${f.name}  ${f.startPath}\n${f.tests.map((t) => `      · ${t.name}`).join("\n")}`);
  if (setup) console.log(`setup (${setup.when}): ${setup.steps.map((s) => `${s.text}${s.actions ? " ✓" : ""}`).join(" → ")}`);
  for (const t of tests) console.log(`  ${t.status.padEnd(7)} [${t.feature}] ${t.spec.name}${t.note ? ` — ${t.note}` : ""}`);
}

try {
  if (command === "look") await pass("look");
  else if (command === "setup") await pass("setup");
  else if (command === "explore" || command === "pass") await pass();
  else if (command === "run") await run();
  else if (command === "show") await show();
  else throw new Error(`Unknown command "${command}".`);
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
