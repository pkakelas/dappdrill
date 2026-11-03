import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/** The repo root (where pnpm-workspace.yaml lives), so relative paths in .env mean the same to the web and the worker. */
function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) return process.cwd();
    dir = up;
  }
  return dir;
}

function int(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const artifacts = process.env.ARTIFACTS_DIR ?? "./data/artifacts";

export const config = {
  /** Artifacts live under <root>/<kind>/<id>/ (see artifacts.ts). Relative to the repo root, as in the web app. */
  artifactsRoot: isAbsolute(artifacts) ? artifacts : resolve(repoRoot(), artifacts),
  appUrl: (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
  dev: process.env.DAPPDRILL_DEV === "1",
  scanConcurrency: int("DAPPDRILL_SCAN_CONCURRENCY", 1),
  batchConcurrency: int("DAPPDRILL_BATCH_CONCURRENCY", 2),
  flowChangeConcurrency: int("DAPPDRILL_FLOW_CHANGE_CONCURRENCY", 2),
  stopPollMs: int("DAPPDRILL_STOP_POLL_MS", 2000),
};
