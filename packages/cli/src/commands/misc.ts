import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Flow, ScanReport, VERDICT_LABEL, describeStep, type Verdict } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { CiApi } from "../ci-api.js";
import { UsageError, loadBaselines, loadFlows, loadReport, readJson, writeJson } from "../files.js";
import { consoleSink } from "../progress.js";
import { parseTarget } from "./scan.js";

export async function pushFlowsCommand(flags: { flowsDir: string; reportTo?: string; tokenEnv: string }): Promise<number> {
  if (!flags.reportTo) throw new UsageError("Pass --report-to <app url>.");
  const api = CiApi.fromEnv(flags.reportTo, flags.tokenEnv);
  const flows = await loadFlows([], flags.flowsDir);
  if (flows.length === 0) throw new UsageError(`No flows in ${flags.flowsDir}.`);
  await api.pushFlows(flows);
  console.log(`Pushed ${flows.length} flow(s) to ${flags.reportTo}`);
  return 0;
}

export async function describeCommand(description: string, flags: { url: string; out: string; flow?: string; headed?: boolean }): Promise<number> {
  const existing = flags.flow ? Flow.parse(await readJson(flags.flow)) : undefined;
  const engine = await loadEngine();
  const artifactsDir = await mkdtemp(join(tmpdir(), "dappdrill-describe-"));
  const { flow, explanation } = await engine.describeFlow(
    parseTarget({ url: flags.url }),
    description,
    { artifactsDir, existing, headless: !flags.headed },
    consoleSink(),
  );
  await writeJson(resolve(flags.out), flow);
  console.log(`\n${explanation}\n`);
  flow.steps.forEach((s, i) => console.log(`  ${i + 1}. ${describeStep(s)}`));
  console.log(`\nSaved ${flow.name} to ${resolve(flags.out)}`);
  return 0;
}

/** Accept the signing reviews in a report as the new baseline (keyed by fingerprint). */
export async function baselineAcceptCommand(flags: { from: string; baseline: string }): Promise<number> {
  const report = await loadReport(flags.from, ScanReport);
  const baselines = await loadBaselines(flags.baseline);
  const counts: Partial<Record<Verdict, number>> = {};
  for (const review of report.signingReviews) {
    baselines[review.fingerprint] = review;
    counts[review.verdict] = (counts[review.verdict] ?? 0) + 1;
  }
  const sorted = Object.fromEntries(Object.entries(baselines).sort(([a], [b]) => a.localeCompare(b)));
  await writeJson(resolve(flags.baseline), sorted);
  const summary = Object.entries(counts).map(([v, n]) => `${n} ${VERDICT_LABEL[v as Verdict]}`).join(", ");
  console.log(`Accepted ${report.signingReviews.length} signing review(s)${summary ? ` (${summary})` : ""} into ${resolve(flags.baseline)}`);
  if (counts.dangerous) console.log("Note: Dangerous reviews were accepted too. Future runs compare against them, so they won't show as changed.");
  return 0;
}
