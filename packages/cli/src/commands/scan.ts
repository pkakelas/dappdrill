import { join, resolve } from "node:path";
import { DrillTarget, DEFAULT_EDGE_CASES, type ChainConfig } from "@dappdrill/core";
import { loadEngine } from "@dappdrill/engine/fake";
import { UsageError, parseChain, parseEdgeCases, saveFlows, writeJson, writeText } from "../files.js";
import { consoleSink } from "../progress.js";
import { healthLine, renderMarkdown } from "../report/index.js";
import { interruptSignal } from "./util.js";

export interface ScanFlags {
  chain: string[];
  edgeCases?: string;
  maxMinutes?: string;
  maxFlows?: string;
  out: string;
  liveKeyEnv?: string;
  hints?: string;
  headed?: boolean;
}

export async function scanCommand(url: string, flags: ScanFlags): Promise<number> {
  const chains: ChainConfig[] = flags.chain.map(parseChain);
  const liveKey = flags.liveKeyEnv ? process.env[flags.liveKeyEnv] : undefined;
  if (flags.liveKeyEnv && !liveKey) throw new UsageError(`${flags.liveKeyEnv} is not set.`);
  const target = parseTarget({ url, chains, edgeCases: flags.edgeCases ? parseEdgeCases(flags.edgeCases) : DEFAULT_EDGE_CASES, liveKey });

  const out = resolve(flags.out);
  const engine = await loadEngine();
  console.log(`Scanning ${target.url}`);
  const report = await engine.scan(
    target,
    {
      artifactsDir: join(out, "artifacts"),
      maxMinutes: flags.maxMinutes ? Number(flags.maxMinutes) : undefined,
      maxFlows: flags.maxFlows ? Number(flags.maxFlows) : undefined,
      hints: flags.hints,
      headless: !flags.headed,
    },
    consoleSink(),
    interruptSignal(),
  );

  await writeJson(join(out, "report.json"), report);
  await writeText(join(out, "report.md"), renderMarkdown(report, { title: "DappDrill scan" }));
  await saveFlows(report.flows, join(out, "flows"));

  console.log(`\n${healthLine(report)}`);
  if (report.stoppedEarly) console.log("Stopped early: results are partial.");
  console.log(`Report: ${join(out, "report.md")}`);
  if (report.flows.length > 0) console.log(`Flows:  ${join(out, "flows")} (copy them to .dappdrill/flows to replay in CI)`);
  return 0;
}

export function parseTarget(input: unknown): DrillTarget {
  const parsed = DrillTarget.safeParse(input);
  if (!parsed.success) throw new UsageError(`Bad target: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}
