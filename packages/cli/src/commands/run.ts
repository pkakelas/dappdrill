import { join, resolve } from "node:path";
import { nowIso, type ChainConfig, type EdgeCaseId, type Flow, type ScanReport, type WalletProfileId } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { CiApi, ciContext } from "../ci-api.js";
import { UsageError, loadBaselines, loadFlows, parseChain, parseEdgeCases, parseToken, parseHeaders, parseResponses, parseStorage, readInitScripts, writeJson, writeText } from "../files.js";
import { consoleSink } from "../progress.js";
import { exitCodeFor, healthLine, renderJunit, renderMarkdown, reportHealth, type FailOn } from "../report/index.js";
import { parseTarget } from "./scan.js";
import { interruptSignal } from "./util.js";

export interface RunFlags {
  url?: string;
  flowsDir: string;
  chain: string[];
  edgeCases?: string;
  baseline: string;
  junit?: string;
  out: string;
  failOn: string;
  pull?: boolean;
  reportTo?: string;
  tokenEnv: string;
  headed?: boolean;
  video: boolean;
  token: string[];
  initScript: string[];
  header: string[];
  storage: string[];
  respond: string[];
}

export async function runCommand(files: string[], flags: RunFlags): Promise<number> {
  const failOn = parseFailOn(flags.failOn);
  const api = flags.pull || flags.reportTo ? CiApi.fromEnv(requireUrl(flags.reportTo, "--pull needs --report-to <app url>"), flags.tokenEnv) : undefined;

  let flows: Flow[] = await loadFlows(files, flags.flowsDir);
  let url = flags.url;
  let edgeCases: EdgeCaseId[] | undefined = flags.edgeCases ? parseEdgeCases(flags.edgeCases) : undefined;
  let chains: ChainConfig[] = flags.chain.map(parseChain);
  let wallets: WalletProfileId[] | undefined;
  if (flags.pull && api) {
    const pulled = await api.pullFlows();
    console.log(`Pulled ${pulled.flows.length} flow(s) from ${flags.reportTo}`);
    // Local files win over pulled flows with the same id.
    const local = new Set(flows.map((f) => f.id));
    flows = [...pulled.flows.filter((f) => !local.has(f.id)), ...flows];
    url ??= pulled.app.url;
    edgeCases ??= pulled.app.settings.edgeCases;
    if (chains.length === 0) chains = pulled.app.settings.chains ?? [];
    wallets = pulled.app.settings.wallets;
  }
  if (!url) throw new UsageError("Pass --url <dApp url> (or --pull to use the app's URL).");
  if (flows.length === 0) throw new UsageError(`No flows in ${flags.flowsDir}. Save some with \`dappdrill scan\` or \`dappdrill describe\`, or use --pull.`);

  const target = parseTarget({
    url,
    chains,
    edgeCases: edgeCases ?? ["happy"],
    wallets,
    tokens: flags.token.map(parseToken),
    initScripts: await readInitScripts(flags.initScript),
    headers: parseHeaders(flags.header),
    storage: parseStorage(flags.storage),
    responses: await parseResponses(flags.respond),
  });
  const out = resolve(flags.out);
  const engine = await loadEngine();
  const signal = interruptSignal();
  console.log(`Replaying ${flows.length} flow(s) on ${target.url} under: ${target.edgeCases.join(", ")}`);
  const startedAt = nowIso();
  const result = await engine.replay(
    target,
    flows,
    {
      edgeCases: target.edgeCases,
      artifactsDir: join(out, "artifacts"),
      baselines: await loadBaselines(flags.baseline),
      headless: !flags.headed,
      video: flags.video,
    },
    consoleSink(flows),
    signal,
  );

  const report: ScanReport = {
    url: target.url,
    startedAt,
    finishedAt: nowIso(),
    chains: target.chains,
    pages: [],
    flows,
    ...result,
    costUsd: 0,
    stoppedEarly: signal.aborted,
  };
  await writeJson(join(out, "report.json"), report);
  await writeText(join(out, "report.md"), renderMarkdown(report, { title: "DappDrill run" }));
  if (flags.junit) await writeText(resolve(flags.junit), renderJunit(report));

  if (flags.reportTo && api) {
    try {
      await api.report({ ...ciContext(), runs: report.runs, issues: report.issues, signingReviews: report.signingReviews });
      console.log(`Reported results to ${flags.reportTo}`);
    } catch (e) {
      console.error(`Could not report results: ${(e as Error).message}`);
    }
  }

  const health = reportHealth(report);
  console.log(`\n${healthLine(report)}`);
  console.log(`Report: ${join(out, "report.md")}${flags.junit ? `\nJUnit:  ${resolve(flags.junit)}` : ""}`);
  return exitCodeFor(health, failOn);
}

function parseFailOn(value: string): FailOn {
  if (value === "broken" || value === "review" || value === "never") return value;
  throw new UsageError(`--fail-on must be broken, review or never (got "${value}")`);
}

export function requireUrl(value: string | undefined, message: string): string {
  if (!value) throw new UsageError(message);
  return value;
}
