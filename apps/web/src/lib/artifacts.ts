import type { ArtifactKind } from "./jobs";

/** Where a result's artifact paths are relative to: the scan or batch that produced it. */
export function artifactOwner(row: { scanId?: string | null; batchId?: string | null }): { kind: ArtifactKind; id: string } | null {
  if (row.scanId) return { kind: "scans", id: row.scanId };
  if (row.batchId) return { kind: "batches", id: row.batchId };
  return null;
}

export function artifactUrl(owner: { kind: ArtifactKind; id: string } | null, path: string | undefined | null, share?: string): string | null {
  if (!owner || !path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const clean = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  return `/api/artifacts/${owner.kind}/${owner.id}/${clean}${share ? `?share=${encodeURIComponent(share)}` : ""}`;
}
