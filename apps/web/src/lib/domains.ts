import "server-only";
import { resolveTxt } from "node:dns/promises";
import { db, domains } from "@dappdrill/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { env } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function hostOf(url: string): string {
  return new URL(url).hostname.toLowerCase();
}

/** Scheduled and CI runs need the app's host verified by its organization. */
export async function isHostVerified(orgId: string, host: string): Promise<boolean> {
  if (env.dev && LOCAL_HOSTS.has(host)) return true;
  const [row] = await db()
    .select({ id: domains.id })
    .from(domains)
    .where(and(eq(domains.organizationId, orgId), eq(domains.host, host), isNotNull(domains.verifiedAt)));
  return Boolean(row);
}

export const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Checks https://<host>/.well-known/dappdrill.txt, then DNS TXT "dappdrill-verify=<token>". */
export async function checkDomain(host: string, token: string): Promise<"file" | "dns" | null> {
  if (!HOST_RE.test(host)) return null;
  try {
    const res = await fetch(`https://${host}/.well-known/dappdrill.txt`, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.ok && (await res.text()).includes(token)) return "file";
  } catch {
    // fall through to DNS
  }
  try {
    const records = await resolveTxt(host);
    if (records.some((parts) => parts.join("").trim() === `dappdrill-verify=${token}`)) return "dns";
  } catch {
    // no TXT records
  }
  return null;
}
