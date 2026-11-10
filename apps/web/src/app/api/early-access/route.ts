import { db, earlyAccess } from "@dappdrill/db";
import { z } from "zod";
import { env } from "@/lib/env";

// The marketing site's "Get early access" form posts here. Public: no login.

const Body = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  /** Hidden field people leave empty; bots fill it in, and get a quiet "ok". */
  website: z.string().optional(),
});

const cors = {
  "Access-Control-Allow-Origin": env.siteUrl,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a valid email address." }, { status: 400, headers: cors });
  if (!parsed.data.website) await db().insert(earlyAccess).values({ email: parsed.data.email }).onConflictDoNothing();
  return Response.json({ ok: true }, { headers: cors });
}
