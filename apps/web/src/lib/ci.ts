import "server-only";
import { apiTokens, apps, db, sha256 } from "@dappdrill/db";
import { eq } from "drizzle-orm";
import { isHostVerified } from "./domains";
import type { App } from "./session";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Resolves the app for a `Authorization: Bearer <token>` request, or returns the error response. */
export async function ciAuth(req: Request, opts: { needsVerifiedDomain?: boolean } = {}): Promise<{ app: App } | { error: Response }> {
  const header = req.headers.get("authorization");
  if (!header) return { error: json({ error: "Missing bearer token. Create one under Account → API tokens." }, 401) };
  const m = header.match(/^Bearer\s+(\S{10,200})$/i);
  if (!m) return { error: json({ error: "Unknown or revoked token." }, 401) };
  const [row] = await db()
    .select({ app: apps, tokenId: apiTokens.id })
    .from(apiTokens)
    .innerJoin(apps, eq(apps.id, apiTokens.appId))
    .where(eq(apiTokens.tokenHash, sha256(m[1]!)));
  if (!row) return { error: json({ error: "Unknown or revoked token." }, 401) };
  await db().update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.tokenId));
  if (opts.needsVerifiedDomain && !(await isHostVerified(row.app.teamId, row.app.host))) {
    return { error: json({ error: `CI runs need ${row.app.host} verified. Verify it under Account → Domains.` }, 403) };
  }
  return { app: row.app };
}

/** Parses a JSON body, capped at `max` bytes. */
export async function readJson(req: Request, max = 20_000_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > max) throw new Error("Request body is too large.");
  return JSON.parse(text);
}
