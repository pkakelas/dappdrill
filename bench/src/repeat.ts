/**
 * Runs a dev-harness suite several times over and measures what moves: the pass rate of each
 * test, the tests that flip between runs, the steps that fell back to the model, cost and time.
 * That is the flake rate of our own side on one app, the number a client's first week is judged by.
 *
 *   tsx bench/src/repeat.ts <url> [--runs N] [--only text] [--date D]   runs `pnpm drill run <url> --keep-wallet` N times (costs money)
 *   tsx bench/src/repeat.ts <url> --report [--date D]                   scores the runs already saved
 *
 * The suite is what `pnpm drill` saved under .drill/<host>/ (tests.json, setup.json, the wallet).
 * Every run keeps that wallet (--keep-wallet), so an app that makes an account of each new wallet
 * gets none. Runs go one after another: a live account can't take two at once. Results go to
 * results/<date>/repeat-<host>/run<i>.json and run<i>.log, then report.md beside them.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TestRunResult, TestRunStatus, TestSpec } from "@dappdrill/core";

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(BENCH, "..");
const ENGINE = path.join(ROOT, "packages/engine");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");

interface Outcome {
  testId: string;
  status: TestRunStatus;
  result: TestRunResult;
}
interface Run {
  n: number;
  ms: number;
  outcomes: Outcome[];
}

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--") && !isOptionValue(a));
if (!url) throw new Error("Usage: repeat.ts <url> [--runs N] [--only text] [--date D] [--report]");
const host = new URL(url).host;
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
function isOptionValue(a: string): boolean {
  const i = args.indexOf(a);
  return i > 0 && ["--runs", "--only", "--date"].includes(args[i - 1]!);
}
const runs = Number(opt("runs", "3"));
const date = opt("date", new Date().toISOString().slice(0, 10));
const OUT = path.join(BENCH, "results", date, `repeat-${host}`);
const DRILL = path.join(ROOT, ".drill", host);

async function main(): Promise<void> {
  if (!existsSync(path.join(DRILL, "tests.json"))) throw new Error(`No suite under ${DRILL}: run \`pnpm drill pass ${url}\` first.`);
  await mkdir(OUT, { recursive: true });
  if (!args.includes("--report")) {
    const done = (await saved()).length;
    for (let i = done + 1; i <= done + runs; i++) await runOnce(i);
  }
  await report();
}

async function runOnce(i: number): Promise<void> {
  console.log(`[repeat] ${host} run ${i}`);
  const started = Date.now();
  const logFile = createWriteStream(path.join(OUT, `run${i}.log`));
  const only = args.includes("--only") ? ["--only", opt("only", "")] : [];
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(TSX, ["dev/drill.ts", "run", url!, "--keep-wallet", ...only], { cwd: ENGINE, env: process.env });
    child.stdout.pipe(logFile, { end: false });
    child.stderr.pipe(logFile, { end: false });
    child.on("close", (code) => resolve(code ?? 2));
  });
  await new Promise((resolve) => logFile.end(resolve));
  const ms = Date.now() - started;
  if (exitCode !== 0) console.log(`[repeat] run ${i} exited ${exitCode}; see run${i}.log`);
  const state = path.join(DRILL, "state-run.json");
  if (existsSync(state)) await copyFile(state, path.join(OUT, `run${i}.json`));
  await writeFile(path.join(OUT, `run${i}.meta.json`), JSON.stringify({ ms, exitCode }));
  console.log(`[repeat] run ${i} done in ${min(ms)}`);
}

async function saved(): Promise<Run[]> {
  const files = (await readdir(OUT).catch(() => [] as string[])).filter((f) => /^run\d+\.json$/.test(f));
  const out: Run[] = [];
  for (const f of files) {
    const n = Number(f.match(/\d+/)![0]);
    const outcomes = JSON.parse(await readFile(path.join(OUT, f), "utf8")) as Outcome[];
    const meta = await readFile(path.join(OUT, `run${n}.meta.json`), "utf8").then((s) => JSON.parse(s) as { ms: number }, () => ({ ms: 0 }));
    out.push({ n, ms: meta.ms, outcomes });
  }
  return out.sort((a, b) => a.n - b.n);
}

// ── scoring ──────────────────────────────────────────────────────────────────

const MARK: Record<TestRunStatus, string> = { pass: "✓", fail: "✗", error: "E", stopped: "S", skipped: "–", queued: "·", running: "…" };
const min = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
const usd = (n: number) => `$${n.toFixed(2)}`;
const onModel = (r: TestRunResult) => [...r.steps, ...(r.after ?? []), ...(r.setup && !r.setup.reused ? [...r.setup.steps, ...(r.setup.reset ?? [])] : [])].filter((s) => s.via === "agent").length;

async function report(): Promise<void> {
  const all = await saved();
  if (!all.length) return console.log("No runs saved yet.");
  const specs = (JSON.parse(await readFile(path.join(DRILL, "tests.json"), "utf8")) as { spec: TestSpec }[]).map((t) => t.spec);
  const name = (id: string) => specs.find((s) => s.id === id)?.name ?? id;
  const ids = [...new Set(all.flatMap((r) => r.outcomes.map((o) => o.testId)))];

  const lines: string[] = [`# ${host}: ${all.length} run${all.length === 1 ? "" : "s"} of the same suite`, ""];
  lines.push("| Test | " + all.map((r) => `Run ${r.n}`).join(" | ") + " | Passed | On the model | Cost |", "|---|" + all.map(() => "---").join("|") + "|---|---|---|");
  let flips = 0;
  for (const id of ids) {
    const row = all.map((r) => r.outcomes.find((o) => o.testId === id));
    const marks = row.map((o) => (o ? MARK[o.status] : "·"));
    const passed = row.filter((o) => o?.status === "pass").length;
    const seen = new Set(row.filter(Boolean).map((o) => o!.status));
    if (seen.size > 1) flips++;
    const agent = row.map((o) => (o ? onModel(o.result) : 0));
    const cost = row.reduce((a, o) => a + (o?.result.costUsd ?? 0), 0);
    lines.push(`| ${name(id)} | ${marks.join(" | ")} | ${passed}/${row.filter(Boolean).length}${seen.size > 1 ? " flips" : ""} | ${agent.join(" ")} | ${usd(cost)} |`);
  }
  lines.push("", "| Run | Passed | On the model | Cost | Time | Setup |", "|---|---|---|---|---|---|");
  for (const r of all) {
    const passed = r.outcomes.filter((o) => o.status === "pass").length;
    const cost = r.outcomes.reduce((a, o) => a + (o.result.costUsd ?? 0), 0);
    const agent = r.outcomes.reduce((a, o) => a + onModel(o.result), 0);
    const first = r.outcomes.find((o) => o.result.setup && !o.result.setup.reused)?.result.setup;
    const setupMs = first ? [...first.steps, ...(first.reset ?? [])].reduce((a, s) => a + (s.durationMs ?? 0), 0) : 0;
    lines.push(`| ${r.n} | ${passed}/${r.outcomes.length} | ${agent} | ${usd(cost)} | ${min(r.ms)} | ${(setupMs / 1000).toFixed(0)} s${first?.reset ? ` (reset ${first.reset.filter((s) => s.status === "pass").length}/${first.reset.length})` : ""} |`);
  }
  lines.push("", `${flips} of ${ids.length} tests changed outcome between runs.`);
  // Why each non-pass: the step that failed or the verdict, once per distinct reason.
  const reasons = new Map<string, string[]>();
  for (const r of all)
    for (const o of r.outcomes) {
      if (o.status === "pass") continue;
      const failed = o.result.steps.find((s) => s.status === "fail");
      const why = o.result.failure ?? failed?.note ?? o.result.verdict?.reason ?? o.status;
      const key = `${name(o.testId)}: ${why.slice(0, 220)}`;
      reasons.set(key, [...(reasons.get(key) ?? []), `run ${r.n}`]);
    }
  if (reasons.size) {
    lines.push("", "## Why tests didn't pass", "");
    for (const [key, where] of reasons) lines.push(`- ${key} (${where.join(", ")})`);
  }
  const md = lines.join("\n") + "\n";
  await writeFile(path.join(OUT, "report.md"), md);
  console.log(md);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
