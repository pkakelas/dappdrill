import type { ArtifactKind } from "./jobs";

/** URL of an artifact a job wrote; `path` is relative to that job's directory. */
export function artifactUrl(kind: ArtifactKind, id: string, path: string | undefined | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `/api/artifacts/${kind}/${id}/${clean}`;
}
