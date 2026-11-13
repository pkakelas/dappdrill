import { apps, db, member } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { readSite } from "@/lib/site";

/** The icon an app's site declares, as the New app page finds it. A redirect, so the browser loads it from the site itself. */
export async function GET(_req: Request, { params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 404 });
  const [row] = await db()
    .select({ url: apps.url })
    .from(apps)
    .innerJoin(member, and(eq(member.organizationId, apps.organizationId), eq(member.userId, session.user.id)))
    .where(eq(apps.id, appId));
  const icon = row && (await readSite(row.url))?.icon;
  if (!icon) return new Response(null, { status: 404, headers: { "cache-control": "private, max-age=3600" } });
  return new Response(null, { status: 302, headers: { location: icon, "cache-control": "private, max-age=86400" } });
}
