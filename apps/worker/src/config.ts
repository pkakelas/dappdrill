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
  analysisConcurrency: int("DAPPDRILL_ANALYSIS_CONCURRENCY", 1),
  testsConcurrency: int("DAPPDRILL_TESTS_CONCURRENCY", 2),
  /** Drafts and assistant replies: small model calls, sometimes a short browse. */
  chatConcurrency: int("DAPPDRILL_CHAT_CONCURRENCY", 4),
  /** Explorations at once; each runs up to `explorers` browsers and forks. */
  explorationConcurrency: int("DAPPDRILL_EXPLORATION_CONCURRENCY", 1),
  explorers: int("DAPPDRILL_EXPLORERS", 3),
  stopPollMs: int("DAPPDRILL_STOP_POLL_MS", 2000),
};
