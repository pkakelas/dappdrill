import { copyFile, link, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "./config.js";

/**
 * Same layout as the web app (apps/web/src/lib/jobs.ts): a job writes into
 * ARTIFACTS_DIR/<kind>/<id>/ and every artifact path stored in rows (live frames,
 * step screenshots, videos) stays relative to that directory. Test runs write per
 * batch: runs/<batchId>/. The web serves /api/artifacts/<kind>/<id>/<path>.
 */
export type ArtifactKind = "runs" | "agent" | "explorations";

export function artifactsDir(kind: ArtifactKind, id: string, root = config.artifactsRoot): string {
  return join(root, kind, id);
}

/** A stored artifact path: relative, one file with an extension, no way up and out. */
const FILE = /^(?!\/)(?!.*\.\.)[\w./-]+\.\w{2,5}$/;

/**
 * Gives another job's artifacts to this one: every relative path in `value` that is a file under
 * `from` is linked to the same path under `to`, so the paths stored with it work from the new job.
 * A hard link costs nothing; where one can't be made, the file is copied.
 */
export async function shareArtifacts(value: unknown, from: string, to: string): Promise<void> {
  const paths = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (FILE.test(v)) paths.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(value);
  for (const path of paths) {
    const source = join(from, path);
    const target = join(to, path);
    if (!(await stat(source).catch(() => undefined))?.isFile()) continue;
    await mkdir(dirname(target), { recursive: true });
    await link(source, target).catch(() => copyFile(source, target));
  }
}
