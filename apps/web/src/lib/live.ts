import type { DrillEvent } from "@dappdrill/core";
import type { JobStatus } from "@dappdrill/db";

/** What the live view needs from the scans row, sent with every SSE tick. */
export interface ScanSnapshot {
  status: JobStatus;
  stages: Partial<Record<string, { status: "running" | "done"; progress: number }>>;
  liveFrame: string | null;
  pages: number;
  costUsd: number;
  startedAt: string | null;
  stopRequested: boolean;
  error: string | null;
  chains: { id: number; name?: string; mode: "fork" | "live" }[];
}

export interface LiveEvent {
  id: number;
  at: string;
  event: DrillEvent;
}

export const TERMINAL: JobStatus[] = ["done", "failed", "stopped"];
