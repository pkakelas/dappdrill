import { join } from "node:path";
import { config } from "./config.js";

/**
 * Same layout as the web app (apps/web/src/lib/jobs.ts): a job writes into
 * ARTIFACTS_DIR/<kind>/<id>/ and every artifact path stored in rows (live frames,
 * step screenshots, videos) stays relative to that directory. Test runs write per
 * batch: runs/<batchId>/. The web serves /api/artifacts/<kind>/<id>/<path>.
 */
export type ArtifactKind = "analyses" | "runs" | "agent";

export function artifactsDir(kind: ArtifactKind, id: string, root = config.artifactsRoot): string {
  return join(root, kind, id);
}
