/**
 * Public engine API. The worker and the CLI only use these functions, so the
 * engine runs the same with or without a database.
 */
import type {
  DrillEventSink,
  DrillTarget,
  Flow,
  FlowRun,
  Issue,
  ReplayOptions,
  ScanOptions,
  ScanReport,
  SigningReview,
} from "@dappdrill/core";
import type { Llm } from "./types.js";

export interface ReplayResult {
  runs: FlowRun[];
  issues: Issue[];
  signingReviews: SigningReview[];
}

/** Discovery scan: map pages, find flows, run the edge-case matrix, review signatures. */
export async function scan(
  target: DrillTarget,
  options: ScanOptions,
  sink: DrillEventSink,
  signal?: AbortSignal,
): Promise<ScanReport> {
  throw new Error("not implemented yet");
}

/** Deterministic replay of saved flows under the given edge cases. No model calls unless a step breaks. */
export async function replay(
  target: DrillTarget,
  flows: Flow[],
  options: ReplayOptions,
  sink: DrillEventSink,
  signal?: AbortSignal,
): Promise<ReplayResult> {
  throw new Error("not implemented yet");
}

/** Turn a plain-English description into a recorded flow by doing it on the site. */
export async function describeFlow(
  target: DrillTarget,
  description: string,
  options: { artifactsDir: string; existing?: Flow; headless?: boolean },
  sink: DrillEventSink,
): Promise<{ flow: Flow; explanation: string }> {
  throw new Error("not implemented yet");
}

/** Propose a fix for a flow whose replay broke. Returns null when it can't find one. */
export async function repairFlow(
  target: DrillTarget,
  flow: Flow,
  failed: FlowRun,
  options: { artifactsDir: string; headless?: boolean },
  sink: DrillEventSink,
): Promise<{ flow: Flow; explanation: string } | null> {
  throw new Error("not implemented yet");
}

export type { Llm };
