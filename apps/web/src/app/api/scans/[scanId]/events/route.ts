import { apps, db, scanEvents, scans } from "@dappdrill/db";
import { and, asc, eq, gt } from "drizzle-orm";
import { TERMINAL, type LiveEvent, type ScanSnapshot } from "@/lib/live";
import { getSession, isMember } from "@/lib/session";

export const dynamic = "force-dynamic";

async function snapshot(scanId: string): Promise<ScanSnapshot | null> {
  const [s] = await db().select().from(scans).where(eq(scans.id, scanId));
  if (!s) return null;
  return {
    status: s.status,
    stages: s.stages,
    liveFrame: s.liveFrame,
    pages: s.pages.length,
    costUsd: s.costUsd,
    startedAt: s.startedAt?.toISOString() ?? null,
    stopRequested: s.stopRequested,
    error: s.error,
    chains: s.chains.map((c) => ({ id: c.id, name: c.name, mode: c.mode })),
  };
}

/**
 * Server-sent events for the scan live view. Polls scan_events and the scans row
 * once a second; resumes after Last-Event-ID / ?after=.
 */
export async function GET(req: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const { scanId } = await params;
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const [row] = await db().select({ teamId: apps.teamId }).from(scans).innerJoin(apps, eq(apps.id, scans.appId)).where(eq(scans.id, scanId));
  if (!row || !(await isMember(session.user.id, row.teamId))) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  let after = Number(req.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0) || 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
      let lastSnap = "";
      send("retry: 3000\n\n");
      try {
        while (!req.signal.aborted) {
          const rows = await db()
            .select()
            .from(scanEvents)
            .where(and(eq(scanEvents.scanId, scanId), gt(scanEvents.id, after)))
            .orderBy(asc(scanEvents.id))
            .limit(500);
          if (rows.length) {
            const batch: LiveEvent[] = rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), event: r.event }));
            after = rows[rows.length - 1]!.id;
            send(`id: ${after}\nevent: events\ndata: ${JSON.stringify(batch)}\n\n`);
          }
          const snap = await snapshot(scanId);
          if (!snap) break;
          const json = JSON.stringify(snap);
          if (json !== lastSnap) {
            send(`event: snapshot\ndata: ${json}\n\n`);
            lastSnap = json;
          } else {
            send(": ping\n\n");
          }
          if (TERMINAL.includes(snap.status) && rows.length < 500) {
            send("event: end\ndata: {}\n\n");
            break;
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        if (!req.signal.aborted) console.error("[sse]", err);
      }
      try {
        controller.close();
      } catch {
        // already closed by the client
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
