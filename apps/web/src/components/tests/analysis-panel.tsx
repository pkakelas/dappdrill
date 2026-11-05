import { BOT_GUIDE_URL, describeBlock, stalledLine } from "@dappdrill/core";
import type { analyses } from "@dappdrill/db";
import Link from "next/link";
import { analyzeAction, stopAnalysisAction } from "@/actions/apps";
import { Elapsed } from "@/components/elapsed";
import { Button } from "@/components/ui/button";
import { artifactUrl } from "@/lib/artifacts";

type Analysis = typeof analyses.$inferSelect;

/** The first look at the app, live; or why it found nothing. */
export function AnalysisPanel({ analysis, appId, host, hasFlows }: { analysis: Analysis; appId: string; host: string; hasFlows: boolean }) {
  const live = analysis.status === "queued" || analysis.status === "running";
  if (live) {
    const frame = artifactUrl("analyses", analysis.id, analysis.liveFrame);
    const lines = analysis.log.slice(-5);
    return (
      <section aria-label="Exploring the app" className="grid overflow-hidden rounded-xl border bg-card shadow-xs md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="relative aspect-[16/10] border-b bg-muted md:border-r md:border-b-0">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frame} alt={`What DappDrill sees on ${host} right now`} className="absolute inset-0 h-full w-full object-cover object-top" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">{analysis.status === "queued" ? "Waiting for a browser…" : "Opening the app…"}</div>
          )}
        </div>
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-medium text-live-ink">
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50" />
                  <span className="relative inline-flex size-2 rounded-full bg-live" />
                </span>
                Exploring
              </span>
              <h2 className="text-base font-semibold">Finding the main flows</h2>
            </div>
            <span className="text-sm text-muted-foreground tabular-nums">{analysis.startedAt ? <Elapsed since={analysis.startedAt.toISOString()} /> : "0:00"}</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">Takes 5–7 minutes. Tests for what it finds show up below and run right away.</p>
          {lines.length > 0 && (
            <ol className="flex flex-col gap-1.5 border-t pt-4">
              {lines.map((l, i) => (
                <li key={`${l.at}-${i}`} className={i === lines.length - 1 ? "text-sm" : "text-sm text-muted-foreground"}>
                  {l.text}
                </li>
              ))}
            </ol>
          )}
          <form action={stopAnalysisAction.bind(null, appId)} className="mt-auto">
            <Button type="submit" variant="outline" size="sm" disabled={analysis.stopRequested}>
              {analysis.stopRequested ? "Stopping…" : "Stop"}
            </Button>
          </form>
        </div>
      </section>
    );
  }

  if (hasFlows) return null;

  let title = "It didn't find a flow to test";
  let body: React.ReactNode = "Add a flow yourself below, or add a note in Settings about where to look and try again.";
  if (analysis.blocked) {
    title = describeBlock(analysis.blocked);
    body = (
      <>
        It stopped at <span className="font-mono text-xs break-all">{analysis.blocked.url}</span>. DappDrill doesn&apos;t solve CAPTCHAs: add an allowlist header in{" "}
        <Link href={`/apps/${appId}/settings#access`} className="text-foreground underline underline-offset-4">
          Settings
        </Link>{" "}
        (
        <a href={BOT_GUIDE_URL} className="text-foreground underline underline-offset-4">
          how
        </a>
        ), then try again.
      </>
    );
  } else if (analysis.stalled) {
    title = "The app's data didn't load";
    body = stalledLine(analysis.stalled);
  } else if (analysis.status === "failed") {
    title = "Something went wrong exploring the app";
    body = analysis.error ? `It stopped with: ${analysis.error}` : "Try again; if it keeps happening, add a note in Settings.";
  } else if (analysis.status === "stopped") {
    title = "Stopped";
    body = "Start it again when you're ready, or add a flow yourself below.";
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-xs">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">{body}</p>
      <form action={analyzeAction.bind(null, appId)}>
        <Button type="submit" size="sm">
          Try again
        </Button>
      </form>
    </section>
  );
}
