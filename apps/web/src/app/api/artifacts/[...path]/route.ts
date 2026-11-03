import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { apps, db, flowChanges, runBatches, scans, teamMembers } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".zip": "application/zip",
  ".html": "text/plain; charset=utf-8", // never render stored HTML on our origin
};

async function appIdFor(kind: string, id: string): Promise<string | undefined> {
  const table = kind === "scans" ? scans : kind === "batches" ? runBatches : kind === "flow-changes" ? flowChanges : null;
  if (!table) return undefined;
  const [row] = await db().select({ appId: table.appId }).from(table).where(eq(table.id, id));
  return row?.appId;
}

async function allowed(appId: string, share: string | null): Promise<boolean> {
  if (share) {
    const [row] = await db().select({ id: apps.id }).from(apps).where(and(eq(apps.id, appId), eq(apps.shareToken, share)));
    if (row) return true;
  }
  const session = await getSession();
  if (!session) return false;
  const [row] = await db()
    .select({ id: apps.id })
    .from(apps)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, apps.teamId), eq(teamMembers.userId, session.user.id)))
    .where(eq(apps.id, appId));
  return Boolean(row);
}

/** Serves ARTIFACTS_DIR/<kind>/<id>/<path> to team members, or to holders of the app's share link. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const [kind, id, ...rest] = path;
  if (!kind || !id || rest.length === 0) return new Response("Not found", { status: 404 });

  const appId = await appIdFor(kind, id);
  const share = new URL(req.url).searchParams.get("share");
  if (!appId || !(await allowed(appId, share))) return new Response("Not found", { status: 404 });

  const root = resolve(env.artifactsDir, kind, id);
  const file = resolve(root, ...rest);
  if (!file.startsWith(root + sep)) return new Response("Not found", { status: 404 });

  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new Response("Not found", { status: 404 });

  const headers = new Headers({
    "Content-Type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, info.size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, { status: 206, headers });
  }
  headers.set("Content-Length", String(info.size));
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
}
