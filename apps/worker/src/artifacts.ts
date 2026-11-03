import { join } from "node:path";
import { config } from "./config.js";

/**
 * Same layout as the web app (apps/web/src/lib/jobs.ts): a job writes into
 * ARTIFACTS_DIR/<kind>/<id>/, and every artifact path stored in results (FlowRun.video,
 * Issue.evidence.screenshot, scans.live_frame, "frame" events…) stays relative to that
 * directory, exactly as the engine reports it. The web serves /api/artifacts/<kind>/<id>/<path>.
 */
export type ArtifactKind = "scans" | "batches" | "flow-changes";

export function artifactsDir(kind: ArtifactKind, id: string, root = config.artifactsRoot): string {
  return join(root, kind, id);
}
