import { Flow } from "@dappdrill/core";
import { db, flows } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ciAuth, json, readJson } from "@/lib/ci";

export const dynamic = "force-dynamic";

/** The app's URL, settings and saved flows, for `dappdrill run --pull`. */
export async function GET(req: Request) {
  const auth = await ciAuth(req, { needsVerifiedDomain: true });
  if ("error" in auth) return auth.error;
  const { app } = auth;
  const rows = await db().select().from(flows).where(and(eq(flows.appId, app.id), eq(flows.archived, false)));
  return json({ app: { url: app.url, settings: app.settings }, flows: rows.map((r) => ({ ...r.definition, id: r.id, name: r.name })) });
}

// Hand-written repo files may leave out origin; they come from code.
const RepoFlow = z.preprocess((v) => (v && typeof v === "object" && !("origin" in v) ? { ...v, origin: "code" } : v), Flow);
const PutBody = z.object({ flows: z.array(RepoFlow).max(500) });

/** Upserts flows by id (repo files → the app). Ids that belong to another app are refused. */
export async function PUT(req: Request) {
  const auth = await ciAuth(req);
  if ("error" in auth) return auth.error;
  const { app } = auth;
  let body: z.infer<typeof PutBody>;
  try {
    const parsed = PutBody.safeParse(await readJson(req));
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return json({ error: `Invalid flows: ${i ? `${i.path.join(".")}: ${i.message}` : "bad body"}` }, 400);
    }
    body = parsed.data;
  } catch {
    return json({ error: "Body must be JSON: { flows: Flow[] }" }, 400);
  }
  const ids = body.flows.map((f) => f.id);
  if (new Set(ids).size !== ids.length) return json({ error: "Two flows share an id." }, 400);
  const existing = ids.length ? await db().select({ id: flows.id, appId: flows.appId }).from(flows).where(inArray(flows.id, ids)) : [];
  const foreign = existing.find((e) => e.appId !== app.id);
  if (foreign) return json({ error: `Flow id ${foreign.id} is already used by another app. Rename it.` }, 409);
  const known = new Set(existing.map((e) => e.id));

  await db().transaction(async (tx) => {
    for (const f of body.flows) {
      if (known.has(f.id)) await tx.update(flows).set({ name: f.name, definition: f, archived: false, updatedAt: new Date() }).where(eq(flows.id, f.id));
      else await tx.insert(flows).values({ id: f.id, appId: app.id, name: f.name, definition: f });
    }
  });
  return json({ created: body.flows.filter((f) => !known.has(f.id)).length, updated: known.size });
}
