import "server-only";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

const artifacts = process.env.ARTIFACTS_DIR ?? "./data/artifacts";

export const env = {
  appUrl: (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, ""),
  /** The marketing site, the one origin allowed to post early access requests. */
  siteUrl: (process.env.SITE_URL ?? "http://localhost:3100").replace(/\/$/, ""),
  /** Lifts plan quotas and treats localhost as a verified domain. */
  dev: process.env.DAPPDRILL_DEV === "1",
  googleEnabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  /** ARTIFACTS_DIR is relative to the repo root, like every other path in .env. */
  artifactsDir: isAbsolute(artifacts) ? artifacts : resolve(repoRoot(), artifacts),
};
