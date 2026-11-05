import { BOT_GUIDE_URL, describeBlock, stalledLine } from "@dappdrill/core";
import type { analyses } from "@dappdrill/db";
import Link from "next/link";
import { analyzeAction } from "@/actions/apps";
import { Elapsed } from "@/components/elapsed";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { artifactUrl } from "@/lib/artifacts";

type Analysis = typeof analyses.$inferSelect;

/** Notes meant for the logs (endpoint counts, fork ports), not for the person watching. */
const ENGINE_NOTE = /^(detect:|chain \d+:)/;

/** The first look at the app as it happens: what the browser sees, and what it's working out. */
function Exploring({ analysis, host, url }: { analysis: Analysis; host: string; url: string }) {
  const frame = artifactUrl("analyses", analysis.id, analysis.liveFrame);
  const lines = analysis.log.filter((l) => !ENGINE_NOTE.test(l.text)).slice(-6);
  const queued = analysis.status === "queued";
  return (
    <section aria-label="Exploring the app" className="grid gap-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-10">
      <BrowserWindow url={url}>
        <div className="relative aspect-[16/10] overflow-hidden bg-card">
          {frame ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={frame} alt={`What DappDrill sees on ${host} right now`} className="absolute inset-0 size-full object-cover object-top" />
          ) : (
            <>
              <SiteLoading />
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border bg-background/85 px-3 py-2 text-sm shadow-md backdrop-blur-md">
                <Spinner className="size-3.5 text-muted-foreground" />
                {queued ? "Waiting for a browser…" : "Opening the app…"}
              </div>
            </>
          )}
        </div>
      </BrowserWindow>

      {/* On wide screens the browser sets the height; old lines fade out of the top instead of growing the page. */}
      <div className="flex flex-col gap-6 md:h-0 md:min-h-full md:py-1">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <LiveDot />
              {queued ? "Queued" : "Exploring"}
            </span>
            {analysis.startedAt ? <Elapsed since={analysis.startedAt.toISOString()} /> : <span className="tabular-nums">0:00</span>}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Finding the main flows</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">Takes 5–7 minutes. Tests for what it finds show up below and run right away.</p>
        </div>

        <ol aria-live="polite" className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-hidden text-sm max-md:[&>li:nth-last-child(n+4)]:hidden md:[mask-image:linear-gradient(to_bottom,transparent,#000_3rem)]">
          {lines.map((l, i) => {
            const last = i === lines.length - 1;
            return (
              <li key={`${l.at}-${l.text}`} className="relative shrink-0 animate-in pl-5 duration-500 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
                {!last && <span aria-hidden="true" className="absolute top-3.5 -bottom-4 left-[3px] w-px bg-border" />}
                <span aria-hidden="true" className={cx("absolute top-[7px] left-0 size-[7px] rounded-full", last ? "bg-foreground" : "bg-border")} />
                <span className={cx("line-clamp-3 leading-snug break-words", !last && "text-muted-foreground")}>{l.text}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-live" />
    </span>
  );
}

/** The first look at the app, live; or why it found nothing. */
export function AnalysisPanel({ analysis, appId, host, url, hasFlows }: { analysis: Analysis; appId: string; host: string; url: string; hasFlows: boolean }) {
  if (analysis.status === "queued" || analysis.status === "running") return <Exploring analysis={analysis} host={host} url={url} />;

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
