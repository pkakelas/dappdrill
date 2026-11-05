/**
 * The real-dApp benchmark. Drives the CLI so it measures what users run.
 *
 *   tsx bench/src/run.ts drill  [ids…]   analyze each dApp, replay its tests, inject bugs (costs money)
 *   tsx bench/src/run.ts report [ids…]   score everything into summary.json and report.md
 *
 * Options: --date YYYY-MM-DD (results folder, default today), --parallel N (dApps at once, default 2),
 * --quick (stop after the replays), --minutes N (analysis budget, default the CLI's), --hints (use the hints in dapps.json; results go
 * to <id>-hints). Load .env first (set -a; . ./.env; set +a) so runs have ANTHROPIC_API_KEY.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EdgeCaseId, TestRunResult, TestRunStatus, TestStep, Verdict } from "@dappdrill/core";
import { FIRED_MARK, MUTATIONS, type Mutation } from "./mutations.js";

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(BENCH, "..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const CLI = path.join(ROOT, "packages/cli/src/main.ts");

const REPLAYS = 3;
/** Unhappy paths a mutation needs; the `unhappy` step runs them clean, as its control. */
const CONTROL_CONDITIONS = [...new Set(MUTATIONS.flatMap((m) => m.edgeCases).filter((e) => e !== "happy"))];

interface Dapp {
  id: string;
  url: string;
  chains: number[];
  tokens: { chainId: number; address: string; amount: string }[];
  hints: string;
  /** A frontend built from source and served on this machine; `serve` is the command that starts it. */
  serve?: string;
  /** The same app with bugs seeded in: the tests made on `url` also run here, and should catch them. */
  buggyUrl?: string;
  /** Test setup: localStorage on the app's origin, and fixed responses as "<url> [status] <body>". */
  storage?: Record<string, string>;
  respond?: string[];
}

interface SavedTest {
  id: string;
  name: string;
  condition?: EdgeCaseId;
  baseId?: string;
  steps: TestStep[];
}
interface TestsFile {
  tests: SavedTest[];
}
interface Outcome {
  testId: string;
  status: TestRunStatus;
  result: TestRunResult;
}
interface Analysis {
  tests: { name: string }[];
  blocked?: unknown;
  stalled?: unknown;
  costUsd: number;
}
interface StepMeta {
  ms: number;
  exitCode: number;
}
/** What a review agent wrote to results/<date>/<id>/review.json after reading the runs. */
interface Review {
  found: { name: string; useful: boolean; expected?: string; note?: string }[];
  missed: string[];
  tests: { test: string; label: "real pass" | "empty pass" | "app bug" | "bad test" | "environment" | "engine bug" | "can't run on a fork"; note: string }[];
  summary: string;
}

const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const optionValues = new Set(["--date", "--parallel", "--minutes"].flatMap((o) => (args.includes(o) ? [args[args.indexOf(o) + 1]] : [])));
const ids = args.slice(1).filter((a) => !a.startsWith("--") && !optionValues.has(a));
const date = opt("date", new Date().toISOString().slice(0, 10));
const useHints = args.includes("--hints");
const quick = args.includes("--quick");
const OUT = path.join(BENCH, "results", date);
const rootOf = (d: Dapp) => path.join(OUT, useHints ? `${d.id}-hints` : d.id);

async function main(): Promise<void> {
  const corpus = (JSON.parse(await readFile(path.join(BENCH, "dapps.json"), "utf8")) as { dapps: Dapp[] }).dapps;
  const picked = ids.length ? corpus.filter((d) => ids.includes(d.id)) : corpus;
  const unknown = ids.filter((id) => !corpus.some((d) => d.id === id));
  if (unknown.length) throw new Error(`Not in dapps.json: ${unknown.join(", ")}`);

  if (command === "drill") {
    await checkServed(picked);
    if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set; the engine falls back to the local Claude Code login.");
    await pool(picked, Number(opt("parallel", "2")), drillDapp);
  } else if (command === "report") {
    await report(picked);
  } else {
    throw new Error("Usage: run.ts drill|report [ids…] [--date D] [--parallel N] [--minutes N] [--hints] [--quick]");
  }
}

// ── running ──────────────────────────────────────────────────────────────────

/** Local frontends must already be up; a run on a dead port would only measure the error page. */
async function checkServed(dapps: Dapp[]): Promise<void> {
  const down = [];
  for (const d of dapps.filter((x) => x.serve)) {
    const up = await fetch(d.url, { signal: AbortSignal.timeout(5000) }).then((r) => r.ok, () => false);
    if (!up) down.push(`${d.id}: ${d.serve}`);
  }
  if (down.length) throw new Error(`Local frontends not running at their URL. Start them with:\n  ${down.join("\n  ")}`);
}

/** BENCH_RPC_<chainId> picks the fork's upstream; the public default rate-limits and prunes state under a real dApp's load. */
function targetFlags(d: Dapp): string[] {
  const chain = (c: number) => (process.env[`BENCH_RPC_${c}`] ? `${c}=${process.env[`BENCH_RPC_${c}`]}` : String(c));
  return [
    ...d.chains.flatMap((c) => ["--chain", chain(c)]),
    ...d.tokens.flatMap((t) => ["--token", `${t.chainId}:${t.address}=${t.amount}`]),
    ...Object.entries(d.storage ?? {}).flatMap(([k, v]) => ["--storage", `${k}=${v}`]),
    ...(d.respond ?? []).flatMap((r) => ["--respond", r]),
  ];
}

async function drillDapp(d: Dapp): Promise<void> {
  const root = rootOf(d);
  const analyzeDir = path.join(root, "analyze");
  const tests = path.join(analyzeDir, "tests.json");
  if (!existsSync(path.join(analyzeDir, "meta.json"))) {
    log(d, "analyzing");
    const minutes = args.includes("--minutes") ? ["--max-minutes", opt("minutes", "")] : [];
    const meta = await cli(analyzeDir, ["analyze", d.url, ...targetFlags(d), "--file", tests, "--out", analyzeDir, "--force", ...minutes, ...(useHints ? ["--hints", d.hints] : [])]);
    log(d, `analyzed in ${min(meta.ms)}, exit ${meta.exitCode}`);
  }
  if (!existsSync(tests)) return log(d, "no tests to replay");

  // Each replay starts from what analyze wrote, like a CI run from the committed file.
  for (let i = 1; i <= REPLAYS; i++) await runStep(d, `replay-${i}`, tests, []);
  if (quick) return log(d, "done");

  if (d.buggyUrl) {
    await runStep(d, "seeded", tests, ["--url", d.buggyUrl, "--unhappy", "--condition", "switch-account", "--condition", "two-wallets"]);
    return log(d, "done");
  }

  const conditions = CONTROL_CONDITIONS.flatMap((c) => ["--condition", c]);
  await runStep(d, "unhappy", tests, conditions);
  const control = path.join(root, "unhappy", "tests.json");
  const outcomes = await readOutcomes(path.join(root, "unhappy"));
  if (!existsSync(control) || !outcomes) return log(d, "no unhappy-path control");

  const saved = JSON.parse(await readFile(control, "utf8")) as TestsFile;
  for (const m of MUTATIONS) {
    const only = applicable(m, saved, outcomes);
    if (only.tests.length === 0) continue;
    const script = path.join(root, "scripts", `${m.id}.js`);
    await mkdir(path.dirname(script), { recursive: true });
    await writeFile(script, m.script);
    await runStep(d, `mutation-${m.id}`, control, ["--init-script", script], only);
  }
  log(d, "done");
}

/** The tests a bug can hit, judged from the clean run's wallet requests, with the happy paths the unhappy ones need. */
function applicable(m: Mutation, saved: TestsFile, outcomes: Outcome[]): TestsFile {
  const requests = (id: string) => outcomes.find((o) => o.testId === id)?.result.walletRequests ?? [];
  const wanted = (t: SavedTest) => m.edgeCases.includes(t.condition ?? "happy") && m.relevant(requests(t.baseId ?? t.id));
  const bases = new Set(saved.tests.filter(wanted).map((t) => t.baseId));
  return { ...saved, tests: saved.tests.filter((t) => wanted(t) || bases.has(t.id)) };
}

/** One `run` over its own copy of a tests file, so steps never learn from each other. */
async function runStep(d: Dapp, name: string, source: string, extra: string[], tests?: TestsFile): Promise<void> {
  const dir = path.join(rootOf(d), name);
  if (existsSync(path.join(dir, "meta.json"))) return;
  log(d, name);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "tests.json");
  await writeFile(file, tests ? JSON.stringify(tests, null, 2) : await readFile(source, "utf8"));
  const meta = await cli(dir, ["run", file, ...targetFlags(d), "--out", dir, ...extra]);
  log(d, `${name} done in ${min(meta.ms)}, exit ${meta.exitCode}`);
}

async function cli(dir: string, argv: string[]): Promise<StepMeta> {
  await mkdir(dir, { recursive: true });
  const started = Date.now();
  const logFile = createWriteStream(path.join(dir, "cli.log"));
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(TSX, [CLI, ...argv], { cwd: ROOT, env: process.env });
    child.stdout.pipe(logFile, { end: false });
    child.stderr.pipe(logFile, { end: false });
    child.on("close", (code) => resolve(code ?? 2));
  });
  await new Promise((resolve) => logFile.end(resolve));
  const meta = { ms: Date.now() - started, exitCode };
  await writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
  return meta;
}

async function pool(items: Dapp[], size: number, work: (item: Dapp) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, size) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await work(item).catch((e) => console.error(`[bench] ${item.id}: ${(e as Error).stack ?? e}`));
      }
    }),
  );
}

// ── scoring ──────────────────────────────────────────────────────────────────

const RANK: Record<Verdict, number> = { consistent: 0, check: 1, dangerous: 2 };
const worst = (o?: Outcome) => Math.max(-1, ...(o?.result.signingReviews ?? []).map((r) => RANK[r.verdict]));

/** Did the test really do something on chain or in the wallet, or could it pass by just looking at a page? */
const signed = (o?: Outcome) => (o?.result.walletRequests ?? []).filter((r) => r.kind === "sign" && r.outcome === "approved").length;

function scoreMutation(m: Mutation, mutated: Outcome[], control: Outcome[], tests: TestsFile) {
  return tests.tests
    .filter((t) => m.edgeCases.includes(t.condition ?? "happy"))
    .flatMap((t) => {
      const o = mutated.find((x) => x.testId === t.id);
      if (!o) return [];
      const c = control.find((x) => x.testId === t.id);
      const base = { mutation: m.id, test: t.name, status: o.status };
      if (!o.result.console.some((l) => l.text.includes(FIRED_MARK))) return [{ ...base, outcome: "not-fired", why: o.result.failure ?? "" }];
      const escalated = o.result.signingReviews.find((r) => RANK[r.verdict] > worst(c));
      if (escalated) return [{ ...base, outcome: "diagnosed", why: `${escalated.verdict}: ${escalated.title}` }];
      const issue = o.result.issues.find((i) => !c?.result.issues.some((x) => x.fingerprint === i.fingerprint));
      if (issue) return [{ ...base, outcome: "diagnosed", why: issue.title }];
      if (c?.status === "pass" && o.status !== "pass") return [{ ...base, outcome: "noticed", why: o.result.failure ?? o.status }];
      return [{ ...base, outcome: "missed", why: `${o.status}, nothing new against the clean run` }];
    });
}

interface AppScore {
  id: string;
  outcome: string;
  tests: string[];
  expected?: string[];
  rows: { test: string; first: string; replays: string[]; signed: number; agentSteps: number; steps: number; failure?: string }[];
  mutations: { mutation: string; test: string; status: string; outcome: string; why: string }[];
  seeded?: { passed: number; total: number; flagged: string[] };
  review?: Review;
  minutes: number;
  costUsd: number;
}

async function report(dapps: Dapp[]): Promise<void> {
  const apps: AppScore[] = [];
  for (const d of dapps) {
    const root = rootOf(d);
    const analysis = await readJson<Analysis>(path.join(root, "analyze", "analysis.json"));
    const meta = await readJson<StepMeta>(path.join(root, "analyze", "meta.json"));
    if (!meta) continue;
    const tests = await readJson<TestsFile>(path.join(root, "analyze", "tests.json"));
    const first = (await readOutcomes(path.join(root, "analyze"))) ?? [];
    const replays = (await Promise.all(Array.from({ length: REPLAYS }, (_, i) => readOutcomes(path.join(root, `replay-${i + 1}`))))).flatMap((r) => (r ? [r] : []));
    const expected = (await readJson<{ tests: string[] }>(path.join(BENCH, "expected", `${d.id}.json`)))?.tests;
    const review = await readJson<Review>(path.join(root, "review.json"));

    const rows = (tests?.tests ?? []).map((t) => {
      const runs = replays.map((r) => r.find((o) => o.testId === t.id));
      const steps = runs.flatMap((o) => o?.result.steps ?? []);
      const lastBad = [...runs].reverse().find((o) => o && o.status !== "pass");
      return {
        test: t.name,
        first: first.find((o) => o.testId === t.id)?.status ?? "–",
        replays: runs.map((o) => o?.status ?? "–"),
        signed: Math.max(0, ...runs.map(signed)),
        agentSteps: steps.filter((s) => s.via === "agent").length,
        steps: steps.length,
        failure: lastBad?.result.failure ?? first.find((o) => o.testId === t.id)?.result.failure,
      };
    });

    const control = (await readOutcomes(path.join(root, "unhappy"))) ?? [];
    const mutations = [];
    for (const m of MUTATIONS) {
      const dir = path.join(root, `mutation-${m.id}`);
      const mutated = await readOutcomes(dir);
      const saved = await readJson<TestsFile>(path.join(dir, "tests.json"));
      if (mutated && saved) mutations.push(...scoreMutation(m, mutated, control, saved));
    }

    const steps = existsSync(root) ? await readdir(root) : [];
    const everyRun = (await Promise.all(steps.map((s) => readOutcomes(path.join(root, s))))).flatMap((o) => o ?? []);
    const minutes = (await Promise.all(steps.map((s) => readJson<StepMeta>(path.join(root, s, "meta.json"))))).reduce((sum, m) => sum + (m?.ms ?? 0), 0) / 60_000;
    const seeded = await readOutcomes(path.join(root, "seeded"));
    apps.push({
      id: d.id,
      outcome: analysis?.blocked ? "blocked" : analysis?.stalled ? "stalled" : !analysis ? `no analysis (exit ${meta.exitCode})` : analysis.tests.length ? "ok" : "no tests",
      tests: tests?.tests.map((t) => t.name) ?? [],
      expected,
      rows,
      mutations,
      seeded: seeded && { passed: seeded.filter((o) => o.status === "pass").length, total: seeded.length, flagged: seeded.flatMap((o) => o.result.signingReviews).filter((r) => r.verdict !== "consistent").map((r) => `${r.verdict}: ${r.title}`) },
      review,
      minutes: Math.round(minutes * 10) / 10,
      costUsd: Math.round(((analysis?.costUsd ?? 0) + everyRun.reduce((sum, o) => sum + o.result.costUsd, 0)) * 100) / 100,
    });
  }
  await writeFile(path.join(OUT, "summary.json"), JSON.stringify(apps, null, 2));
  await writeFile(path.join(OUT, "report.md"), renderReport(apps));
  console.log(`${path.join(OUT, "report.md")}`);
}

function renderReport(apps: AppScore[]): string {
  const lines = [`# DappDrill real-dApp benchmark, ${date}`, "", "| dApp | Analysis | Tests | Expected found | Useful | First run | Passed every replay | Signed something | Steps on the model | Min | Cost |", "|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const a of apps) {
    const stable = a.rows.filter((r) => r.replays.length === REPLAYS && r.replays.every((s) => s === "pass"));
    const found = a.review ? new Set(a.review.found.flatMap((f) => (f.expected ? [f.expected] : []))).size : undefined;
    const steps = a.rows.reduce((s, r) => s + r.steps, 0);
    const cells = [
      a.id,
      a.outcome,
      a.tests.length,
      found === undefined ? "not reviewed" : `${found}/${a.expected?.length ?? "?"}`,
      a.review ? `${a.review.found.filter((f) => f.useful).length}/${a.review.found.length}` : "not reviewed",
      `${a.rows.filter((r) => r.first === "pass").length}/${a.rows.length}`,
      `${stable.length}/${a.rows.length}`,
      `${stable.filter((r) => r.signed > 0).length}/${stable.length}`,
      steps ? `${a.rows.reduce((s, r) => s + r.agentSteps, 0)}/${steps}` : "–",
      a.minutes,
      `$${a.costUsd}`,
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  for (const a of apps) {
    lines.push("", `## ${a.id}`, "");
    if (a.review) lines.push(a.review.summary, "");
    if (a.rows.length) {
      lines.push(`| Test | First run | Replays | Signed | Why not |`, "|---|---|---|---|---|");
      for (const r of a.rows) lines.push(`| ${r.test} | ${r.first} | ${r.replays.join(" ")} | ${r.signed} | ${(r.failure ?? "").replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)} |`);
      lines.push("");
    }
    if (a.seeded) lines.push(`Seeded build: ${a.seeded.passed} of ${a.seeded.total} tests passed. Flagged: ${a.seeded.flagged.join("; ") || "nothing"}.`, "");
    if (a.mutations.length) {
      lines.push("| Injected bug | Test | Outcome | Why |", "|---|---|---|---|");
      for (const m of a.mutations) lines.push(`| ${m.mutation} | ${m.test} | ${m.outcome} | ${m.why.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)} |`);
      lines.push("");
    }
    if (a.review?.tests.length) {
      lines.push("| Reviewed test | Label | Note |", "|---|---|---|");
      for (const t of a.review.tests) lines.push(`| ${t.test} | ${t.label} | ${t.note.replace(/\|/g, "/").replace(/\n/g, " ")} |`);
      lines.push("");
    }
    if (a.review?.missed.length) lines.push(`Expected but not found: ${a.review.missed.join(", ")}.`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  return readFile(file, "utf8").then((t) => JSON.parse(t) as T, () => undefined);
}
const readOutcomes = (dir: string) => readJson<Outcome[]>(path.join(dir, "results.json"));

const min = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
const log = (d: Dapp, text: string) => console.log(`[bench] ${d.id}: ${text}`);

await main();
