/**
 * The real-dApp benchmark. Drives the CLI so it measures what users run.
 *
 *   tsx bench/src/run.ts scan   [ids…]   explore each dApp with the model (costs money)
 *   tsx bench/src/run.ts replay [ids…]   control replays x3, then a replay per injected bug (model-free)
 *   tsx bench/src/run.ts report          score everything into summary.json and report.md
 *
 * Options: --date YYYY-MM-DD (results folder, default today), --parallel N (dApps at once, default 2),
 * --minutes N and --flows N (scan budget, default 12 and 4).
 * Load .env first (set -a; . ./.env; set +a) so scans have ANTHROPIC_API_KEY.
 */
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { EdgeCaseId, FlowRun, Issue, ScanReport, SigningReview, Verdict } from "@dappdrill/core";
import { FIRED_MARK, MUTATIONS, type Mutation } from "./mutations.js";

const BENCH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(BENCH, "..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const CLI = path.join(ROOT, "packages/cli/src/main.ts");

/** Edge cases the control replays run: happy plus every one a mutation needs. */
const CONTROL_EDGES: EdgeCaseId[] = ["happy", ...new Set(MUTATIONS.flatMap((m) => m.edgeCases).filter((e) => e !== "happy"))];
const CONTROL_RUNS = 3;

interface Dapp {
  id: string;
  url: string;
  chains: number[];
  tokens: { chainId: number; address: string; amount: string }[];
  hints: string;
  /** A frontend built from source and served on this machine; `serve` is the command that starts it. */
  serve?: string;
  /** Test setup: localStorage on the app's origin, and fixed responses as "<url> [status] <body>". */
  storage?: Record<string, string>;
  respond?: string[];
}

interface Label {
  label: "true" | "false";
  note?: string;
  /** For a false finding caused by an engine bug: what fixed it. */
  fixed?: string;
}

interface StepMeta {
  ms: number;
  exitCode: number;
}

const args = process.argv.slice(2);
const command = args[0];
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const optionValues = new Set(["--date", "--parallel", "--minutes", "--flows"].flatMap((o) => (args.includes(o) ? [args[args.indexOf(o) + 1]] : [])));
const ids = args.slice(1).filter((a) => !a.startsWith("--") && !optionValues.has(a));
const date = opt("date", new Date().toISOString().slice(0, 10));
const OUT = path.join(BENCH, "results", date);

async function main(): Promise<void> {
  const corpus = (JSON.parse(await readFile(path.join(BENCH, "dapps.json"), "utf8")) as { dapps: Dapp[] }).dapps;
  const picked = ids.length ? corpus.filter((d) => ids.includes(d.id)) : corpus;
  const unknown = ids.filter((id) => !corpus.some((d) => d.id === id));
  if (unknown.length) throw new Error(`Not in dapps.json: ${unknown.join(", ")}`);
  const parallel = Number(opt("parallel", "2"));
  if (command === "scan" || command === "replay") await checkServed(picked);

  if (command === "scan") {
    if (!process.env.ANTHROPIC_API_KEY) console.warn("ANTHROPIC_API_KEY is not set; the engine falls back to the local Claude Code login.");
    await pool(picked, parallel, (d) => scanDapp(d));
  } else if (command === "replay") {
    await pool(picked, parallel, (d) => replayDapp(d));
  } else if (command === "report") {
    await report(picked);
  } else {
    throw new Error("Usage: run.ts scan|replay|report [ids…] [--date D] [--parallel N] [--minutes N] [--flows N]");
  }
}

// ── running ──────────────────────────────────────────────────────────────────

/** Local frontends must already be up; a scan of a dead port would only measure the error page. */
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

async function scanDapp(d: Dapp): Promise<void> {
  const dir = path.join(OUT, d.id, "scan");
  if (existsSync(path.join(dir, "report.json"))) return log(d, "scan already done");
  log(d, "scanning");
  const meta = await cli(dir, ["scan", d.url, ...targetFlags(d), "--max-minutes", opt("minutes", "12"), "--max-flows", opt("flows", "4"), "--hints", d.hints, "--out", dir]);
  const r = await readReport(dir);
  log(d, `scan done in ${min(meta.ms)}: ${r?.flows.length ?? 0} flows, ${r?.issues.length ?? 0} issues, $${r?.costUsd.toFixed(2) ?? "?"}`);
}

async function replayDapp(d: Dapp): Promise<void> {
  const scanDir = path.join(OUT, d.id, "scan");
  const flowsDir = path.join(scanDir, "flows");
  if (!existsSync(flowsDir)) return log(d, "no flows to replay (scan first)");
  const flowFiles = (await readdir(flowsDir)).filter((f) => f.endsWith(".json")).map((f) => path.join(flowsDir, f));
  if (flowFiles.length === 0) return log(d, "the scan found no flows");
  const run = (dir: string, extra: string[], files = flowFiles) =>
    cli(dir, ["run", "--url", d.url, ...targetFlags(d), "--out", dir, "--no-video", "--fail-on", "never", ...extra, ...files]);

  for (let i = 1; i <= CONTROL_RUNS; i++) {
    const dir = path.join(OUT, d.id, `control-${i}`);
    if (existsSync(path.join(dir, "report.json"))) continue;
    log(d, `control ${i}/${CONTROL_RUNS}`);
    await run(dir, ["--edge-cases", CONTROL_EDGES.join(",")]);
  }
  const control = await readReport(path.join(OUT, d.id, "control-1"));
  if (!control) return log(d, "control replay produced no report");

  // Baselines from the first control, for the "regression" variant of the signing bugs.
  const baselineFile = path.join(OUT, d.id, "baselines.json");
  await writeFile(baselineFile, JSON.stringify(Object.fromEntries(control.signingReviews.map((r) => [r.fingerprint, r])), null, 2));

  for (const m of MUTATIONS) {
    const flows = flowFiles.filter((f) => applies(m, flowIdOf(f), control));
    if (flows.length === 0) continue;
    const scriptFile = path.join(OUT, d.id, "scripts", `${m.id}.js`);
    await mkdir(path.dirname(scriptFile), { recursive: true });
    await writeFile(scriptFile, m.script);
    const variants: [string, string[]][] = [[`mutation-${m.id}`, ["--baseline", path.join(OUT, d.id, "no-baselines.json")]]];
    if (m.edgeCases.includes("happy")) variants.push([`mutation-${m.id}-baseline`, ["--baseline", baselineFile]]);
    for (const [name, extra] of variants) {
      const dir = path.join(OUT, d.id, name);
      if (existsSync(path.join(dir, "report.json"))) continue;
      log(d, `${name} on ${flows.length} flow(s)`);
      await run(dir, ["--edge-cases", m.edgeCases.join(","), "--init-script", scriptFile, ...extra], flows);
    }
  }
  log(d, "replays done");
}

/** Only replay a bug on flows whose unmutated run does the thing it breaks. */
function applies(m: Mutation, flowId: string, control: ScanReport): boolean {
  const runs = control.runs.filter((r) => r.flowId === flowId);
  const happy = runs.find((r) => r.edgeCase === "happy");
  const reqs = happy?.walletRequests ?? [];
  const txs = reqs.filter((r) => r.method === "eth_sendTransaction").map((r) => ((r.params as unknown[])?.[0] ?? {}) as { data?: string; input?: string; value?: string });
  const approves = txs.filter((t) => (t.data ?? t.input ?? "").startsWith("0x095ea7b3"));
  const signs = reqs.some((r) => r.kind === "sign");
  switch (m.id) {
    case "unlimited-approval":
      return approves.some((t) => (t.data ?? t.input ?? "").slice(74, 138) !== "f".repeat(64));
    case "approval-to-stranger":
      return approves.length > 0;
    case "inflated-value":
      return txs.some((t) => t.value && BigInt(t.value) > 0n);
    case "signin-is-permit":
      return reqs.some((r) => r.method === "personal_sign");
    case "skips-chain-switch":
      return runs.some((r) => r.edgeCase === "wrong-network" && r.walletRequests.some((w) => w.method === "wallet_switchEthereumChain" || w.method === "wallet_addEthereumChain"));
    default:
      return signs;
  }
}

function flowIdOf(file: string): string {
  return path.basename(file, ".json");
}

async function cli(dir: string, argv: string[]): Promise<StepMeta> {
  await mkdir(dir, { recursive: true });
  const started = Date.now();
  const logFile = createWriteStream(path.join(dir, "cli.log"));
  const exitCode = await new Promise<number>((resolve) => {
    const child = spawn(TSX, [CLI, ...argv], { cwd: ROOT, env: process.env });
    child.stdout.pipe(logFile, { end: false });
    child.stderr.pipe(logFile, { end: false });
    child.on("close", (code) => resolve(code ?? 1));
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

const VERDICT_RANK: Record<Verdict, number> = { consistent: 0, check: 1, dangerous: 2 };
type Outcome = "diagnosed" | "noticed" | "missed" | "not-fired" | "no-run";

interface MutationScore {
  dapp: string;
  mutation: string;
  flowId: string;
  edgeCase: EdgeCaseId;
  variant: "first-run" | "with-baseline";
  outcome: Outcome;
  why: string;
}

/** The signal a mutation should produce when DappDrill really understands the bug. */
function diagnoses(m: Mutation, run: FlowRun, newIssues: Issue[], reviews: SigningReview[], control: Ctl): string | undefined {
  const fresh = reviews.filter((r) => VERDICT_RANK[r.verdict] > control.maxVerdict || newChecks(r, control).length);
  const flagged = (pred: (r: SigningReview) => boolean) => fresh.find(pred);
  switch (m.id) {
    case "unlimited-approval": {
      const r = flagged((r) => r.approvals.some((a) => a.unlimited) && r.checks.some((c) => (c.id === "approval" || c.id === "ui-match") && c.status !== "pass"));
      return r && `${r.verdict}: ${r.title}`;
    }
    case "approval-to-stranger":
    case "signin-is-permit": {
      const r = flagged((r) => r.verdict === "dangerous");
      return r && `dangerous: ${r.title}`;
    }
    case "inflated-value": {
      const r = flagged((r) => r.checks.some((c) => (c.id === "ui-match" || c.id === "expectation" || c.id === "baseline") && c.status !== "pass"));
      return r && `${r.verdict}: ${r.title}`;
    }
    default: {
      const i = newIssues.find((i) => i.edgeCase === run.edgeCase && (i.category === "wallet" || i.category === "ui"));
      return i && `${i.severity} ${i.category}: ${i.title}`;
    }
  }
}

function newChecks(r: SigningReview, control: Ctl): string[] {
  return r.checks.filter((c) => SIGNAL_CHECK.has(c.status) && !control.checks.has(`${c.id}:${c.status}`)).map((c) => `${c.id}:${c.status}`);
}

/** Skipped and unverified checks say what couldn't be looked up, not what's wrong. */
const SIGNAL_CHECK = new Set(["warn", "fail"]);

/**
 * A run's issues and reviews, found through the run's own id lists: reports
 * saved before the engine stamped reviews with their run have no runId on
 * reviews or on the signing issues made from them.
 */
function ofRun(report: ScanReport, run: FlowRun): { issues: Issue[]; reviews: SigningReview[] } {
  const reviewIds = new Set(run.signingReviewIds);
  const issueIds = new Set(run.issueIds);
  return {
    reviews: report.signingReviews.filter((r) => r.runId === run.id || reviewIds.has(r.id)),
    issues: report.issues.filter((i) => i.runId === run.id || issueIds.has(i.id) || (i.evidence.signingReviewId !== undefined && reviewIds.has(i.evidence.signingReviewId))),
  };
}

/** What the unmutated replays of one flow + edge case looked like. */
interface Ctl {
  statuses: FlowRun["status"][];
  fingerprints: Set<string>;
  maxVerdict: number;
  checks: Set<string>;
}

function controlFor(controls: ScanReport[], flowId: string, edgeCase: EdgeCaseId): Ctl {
  const owned = controls.flatMap((c) => c.runs.filter((r) => r.flowId === flowId).map((run) => ({ run, ...ofRun(c, run) })));
  const same = owned.filter((o) => o.run.edgeCase === edgeCase);
  const runs = same.map((o) => o.run);
  const issues = same.flatMap((o) => o.issues);
  // Reviews compare against every clean run of the flow: a mutated run can get further than its edge case's control did.
  const reviews = owned.flatMap((o) => o.reviews);
  return {
    statuses: runs.map((r) => r.status),
    fingerprints: new Set(issues.map((i) => i.fingerprint)),
    maxVerdict: Math.max(-1, ...reviews.map((r) => VERDICT_RANK[r.verdict])),
    checks: new Set(reviews.flatMap((r) => r.checks.filter((c) => SIGNAL_CHECK.has(c.status)).map((c) => `${c.id}:${c.status}`))),
  };
}

function scoreMutation(d: Dapp, m: Mutation, variant: MutationScore["variant"], mutated: ScanReport, controls: ScanReport[]): MutationScore[] {
  return mutated.runs.map((run) => {
    const base = { dapp: d.id, mutation: m.id, flowId: run.flowId, edgeCase: run.edgeCase, variant };
    if (!run.console.some((c) => c.text.includes(FIRED_MARK))) return { ...base, outcome: "not-fired", why: `run ${run.status}: ${run.reason ?? ""}`.trim() };
    const control = controlFor(controls, run.flowId, run.edgeCase);
    const { issues, reviews } = ofRun(mutated, run);
    const newIssues = issues.filter((i) => !control.fingerprints.has(i.fingerprint));
    const diag = diagnoses(m, run, newIssues, reviews, control);
    if (diag) return { ...base, outcome: "diagnosed", why: diag };
    const escalated = reviews.find((r) => VERDICT_RANK[r.verdict] > control.maxVerdict);
    const checks = [...new Set(reviews.flatMap((r) => newChecks(r, control)))];
    const worse = control.statuses.every((s) => s === "pass") && run.status !== "pass";
    const signals = [
      ...newIssues.map((i) => `new ${i.category} issue: ${i.title}`),
      ...(escalated ? [`review went to ${escalated.verdict}: ${escalated.title}`] : []),
      ...(checks.length ? [`new checks ${checks.join(", ")}`] : []),
      ...(worse ? [`run ${run.status} where control passed: ${run.reason ?? ""}`] : []),
    ];
    if (signals.length) return { ...base, outcome: "noticed", why: signals.join("; ") };
    return { ...base, outcome: "missed", why: `run ${run.status}, nothing new vs control` };
  });
}

interface Cell {
  flowId: string;
  flowName: string;
  edgeCase: EdgeCaseId;
  statuses: FlowRun["status"][];
  sameStatus: boolean;
  sameIssues: boolean;
}

function stability(controls: ScanReport[]): Cell[] {
  const first = controls[0];
  if (!first) return [];
  const cells: Cell[] = [];
  for (const flow of first.flows) {
    for (const edgeCase of CONTROL_EDGES) {
      const runs = controls.map((c) => c.runs.find((r) => r.flowId === flow.id && r.edgeCase === edgeCase));
      if (runs.some((r) => !r)) continue;
      const fps = controls.map((c, i) => c.issues.filter((x) => x.runId === runs[i]!.id).map((x) => x.fingerprint).sort().join(","));
      const statuses = runs.map((r) => r!.status);
      cells.push({ flowId: flow.id, flowName: flow.name, edgeCase, statuses, sameStatus: new Set(statuses).size === 1, sameIssues: new Set(fps).size === 1 });
    }
  }
  return cells;
}

async function report(dapps: Dapp[]): Promise<void> {
  const perDapp = [];
  const mutationScores: MutationScore[] = [];
  for (const d of dapps) {
    const dir = path.join(OUT, d.id);
    const scan = await readReport(path.join(dir, "scan"));
    if (!scan) {
      perDapp.push({ id: d.id, url: d.url, scanned: false });
      continue;
    }
    const scanMeta = await readMeta(path.join(dir, "scan"));
    const labels = await readLabels(d.id);
    const label = (list: Issue[]) =>
      [...new Map(list.map((i) => [i.fingerprint, i])).values()].map((i) => ({
        fingerprint: i.fingerprint,
        severity: i.severity,
        category: i.category,
        edgeCase: i.edgeCase,
        title: i.title,
        label: labels[i.fingerprint]?.label,
        note: labels[i.fingerprint]?.note,
        fixed: labels[i.fingerprint]?.fixed,
      }));
    const labeled = label(scan.issues);
    // Every scan attempt cost money, including the ones an engine fix replaced.
    let spentUsd = 0;
    for (const entry of await readdir(dir)) if (entry.startsWith("scan")) spentUsd += (await readReport(path.join(dir, entry)))?.costUsd ?? 0;
    const verdicts = countBy(scan.signingReviews.map((r) => r.verdict));

    const controls = (await Promise.all(Array.from({ length: CONTROL_RUNS }, (_, i) => readReport(path.join(dir, `control-${i + 1}`))))).filter((r): r is ScanReport => !!r);
    const cells = controls.length === CONTROL_RUNS ? stability(controls) : [];
    // The control replays run on the engine as committed, so their findings re-measure precision after the fixes.
    const replayIssues = label(controls.flatMap((c) => c.issues));
    let replayMs = 0;
    for (let i = 1; i <= CONTROL_RUNS; i++) replayMs += (await readMeta(path.join(dir, `control-${i}`)))?.ms ?? 0;

    for (const m of MUTATIONS) {
      for (const [name, variant] of [[`mutation-${m.id}`, "first-run"], [`mutation-${m.id}-baseline`, "with-baseline"]] as const) {
        const mutated = await readReport(path.join(dir, name));
        replayMs += (await readMeta(path.join(dir, name)))?.ms ?? 0;
        if (mutated) mutationScores.push(...scoreMutation(d, m, variant, mutated, controls));
      }
    }

    perDapp.push({
      id: d.id,
      url: d.url,
      scanned: true,
      scanMinutes: scanMeta ? +(scanMeta.ms / 60_000).toFixed(1) : undefined,
      replayMinutes: +(replayMs / 60_000).toFixed(1),
      costUsd: +scan.costUsd.toFixed(2),
      spentUsd: +spentUsd.toFixed(2),
      pages: scan.pages.length,
      flows: scan.flows.map((f) => ({ id: f.id, name: f.name, steps: f.steps.length, setup: f.setup?.map((s) => s.name) })),
      runs: countBy(scan.runs.map((r) => r.status)),
      issues: labeled,
      replayIssues,
      signingVerdicts: verdicts,
      stability: cells.length
        ? { cells: cells.length, sameStatus: cells.filter((c) => c.sameStatus).length, sameIssues: cells.filter((c) => c.sameIssues).length, flaky: cells.filter((c) => !c.sameStatus || !c.sameIssues) }
        : undefined,
    });
  }

  const issues = perDapp.flatMap((d) => ("issues" in d && d.issues ? d.issues : []));
  const tp = issues.filter((i) => i.label === "true").length;
  const fp = issues.filter((i) => i.label === "false").length;
  const fixedFp = issues.filter((i) => i.label === "false" && i.fixed).length;
  const replayIssues = perDapp.flatMap((d) => ("replayIssues" in d && d.replayIssues ? d.replayIssues : []));
  const rtp = replayIssues.filter((i) => i.label === "true").length;
  const rfp = replayIssues.filter((i) => i.label === "false").length;
  const cells = perDapp.flatMap((d) => ("stability" in d && d.stability ? [d.stability] : []));
  const fired = mutationScores.filter((s) => s.outcome !== "not-fired" && s.outcome !== "no-run");
  const byMutation = MUTATIONS.map((m) => {
    const forM = (variant: MutationScore["variant"]) => fired.filter((s) => s.mutation === m.id && s.variant === variant);
    const tally = (s: MutationScore[]) => ({ cases: s.length, diagnosed: s.filter((x) => x.outcome === "diagnosed").length, noticed: s.filter((x) => x.outcome === "noticed").length, missed: s.filter((x) => x.outcome === "missed").length });
    return { id: m.id, bug: m.bug, edgeCases: m.edgeCases, firstRun: tally(forM("first-run")), withBaseline: tally(forM("with-baseline")) };
  });
  const totals = {
    dapps: dapps.length,
    scanned: perDapp.filter((d) => d.scanned).length,
    withFlows: perDapp.filter((d) => "flows" in d && d.flows?.length).length,
    costUsd: +perDapp.reduce((s, d) => s + ("costUsd" in d ? (d.costUsd ?? 0) : 0), 0).toFixed(2),
    spentUsd: +perDapp.reduce((s, d) => s + ("spentUsd" in d ? (d.spentUsd ?? 0) : 0), 0).toFixed(2),
    issues: issues.length,
    labeledTrue: tp,
    labeledFalse: fp,
    unlabeled: issues.length - tp - fp,
    precision: tp + fp ? +(tp / (tp + fp)).toFixed(2) : undefined,
    falseFixed: fixedFp,
    replayIssues: replayIssues.length,
    replayTrue: rtp,
    replayFalse: rfp,
    replayUnlabeled: replayIssues.length - rtp - rfp,
    replayPrecision: rtp + rfp ? +(rtp / (rtp + rfp)).toFixed(2) : undefined,
    stableCells: cells.reduce((s, c) => s + c.sameStatus, 0),
    stableIssueCells: cells.reduce((s, c) => s + c.sameIssues, 0),
    cells: cells.reduce((s, c) => s + c.cells, 0),
    mutationCases: fired.filter((s) => s.variant === "first-run").length,
    diagnosed: fired.filter((s) => s.variant === "first-run" && s.outcome === "diagnosed").length,
    caught: fired.filter((s) => s.variant === "first-run" && s.outcome !== "missed").length,
  };

  const summary: Summary = { date, totals, byMutation, dapps: perDapp, mutationScores };
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(OUT, "report.md"), markdown(summary));
  console.log(`Wrote ${path.join(OUT, "summary.json")} and report.md`);
}

interface Tally {
  cases: number;
  diagnosed: number;
  noticed: number;
  missed: number;
}

interface Summary {
  date: string;
  totals: Record<string, number | undefined>;
  byMutation: { id: string; bug: string; edgeCases: EdgeCaseId[]; firstRun: Tally; withBaseline: Tally }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- per-dApp rows are plain JSON
  dapps: any[];
  mutationScores: MutationScore[];
}

function markdown(s: Summary): string {
  const t = s.totals;
  const pct = (a?: number, b?: number) => (a !== undefined && b ? `${Math.round((100 * a) / b)}%` : "–");
  const lines = [
    `# DappDrill real-dApp benchmark — ${s.date}`,
    "",
    `${t.scanned}/${t.dapps} dApps scanned, ${t.withFlows} with replayable flows. Final scans cost $${t.costUsd}; every scan attempt together $${t.spentUsd}.`,
    "",
    `- **Precision (scans):** ${t.labeledTrue} real / ${t.labeledFalse} false of ${t.issues} distinct findings (${t.unlabeled} unlabeled) → ${t.precision ?? "–"}; ${t.falseFixed} of the false ones were engine bugs fixed since`,
    `- **Precision (replays on the fixed engine, ${CONTROL_EDGES.join("/")}):** ${t.replayTrue} real / ${t.replayFalse} false of ${t.replayIssues} distinct findings (${t.replayUnlabeled} unlabeled) → ${t.replayPrecision ?? "–"}`,
    `- **Replay stability:** same status in ${t.stableCells}/${t.cells} flow × edge-case cells (${pct(t.stableCells, t.cells)}), same findings in ${t.stableIssueCells}/${t.cells} (${pct(t.stableIssueCells, t.cells)})`,
    `- **Injected bugs:** ${t.diagnosed} diagnosed, ${t.caught} caught at all, of ${t.mutationCases} cases where the bug fired`,
    "",
    "## Injected bugs",
    "",
    "| Bug | Edge case | Cases | Diagnosed | Noticed | Missed | With baseline: diagnosed / noticed / missed |",
    "|---|---|---|---|---|---|---|",
    ...s.byMutation.map(
      (m) =>
        `| ${m.id} | ${m.edgeCases.join(", ")} | ${m.firstRun.cases} | ${m.firstRun.diagnosed} | ${m.firstRun.noticed} | ${m.firstRun.missed} | ${m.withBaseline.cases ? `${m.withBaseline.diagnosed} / ${m.withBaseline.noticed} / ${m.withBaseline.missed}` : "–"} |`,
    ),
    "",
    "## Per dApp",
    "",
    "| dApp | Scan min | Cost | All attempts | Flows | Findings (real/false/unlabeled) | Stable cells | Replay min |",
    "|---|---|---|---|---|---|---|---|",
    ...s.dapps.map((d) =>
      d.scanned
        ? `| ${d.id} | ${d.scanMinutes ?? "–"} | $${d.costUsd} | $${d.spentUsd} | ${d.flows.length} | ${d.issues.filter((i: any) => i.label === "true").length}/${d.issues.filter((i: any) => i.label === "false").length}/${d.issues.filter((i: any) => !i.label).length} | ${d.stability ? `${d.stability.sameStatus}/${d.stability.cells}` : "–"} | ${d.replayMinutes} |`
        : `| ${d.id} | not scanned | | | | | | |`,
    ),
    "",
    "## Every mutation case",
    "",
    "| dApp | Bug | Variant | Flow | Outcome | Why |",
    "|---|---|---|---|---|---|",
    ...s.mutationScores.map((m) => `| ${m.dapp} | ${m.mutation} | ${m.variant} | ${m.flowId} | ${m.outcome} | ${m.why.replace(/\|/g, "\\|").slice(0, 160)} |`),
    "",
  ];
  return lines.join("\n");
}

// ── files ────────────────────────────────────────────────────────────────────

async function readReport(dir: string): Promise<ScanReport | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dir, "report.json"), "utf8")) as ScanReport;
  } catch {
    return undefined;
  }
}

async function readMeta(dir: string): Promise<StepMeta | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dir, "meta.json"), "utf8")) as StepMeta;
  } catch {
    return undefined;
  }
}

async function readLabels(id: string): Promise<Record<string, Label>> {
  try {
    return JSON.parse(await readFile(path.join(BENCH, "labels", `${id}.json`), "utf8")) as Record<string, Label>;
  } catch {
    return {};
  }
}

function countBy<T extends string>(xs: T[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

const min = (ms: number) => `${(ms / 60_000).toFixed(1)} min`;
const log = (d: Dapp, m: string) => console.log(`[bench] ${new Date().toISOString().slice(11, 19)} ${d.id}: ${m}`);

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
