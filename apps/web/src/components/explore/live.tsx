"use client";

import { EXPLORE_PHASE_LABEL, TIER_LABEL, type ExplorePhase, type ExploreFeedLine } from "@dappdrill/core";
import { useEffect, useRef, useState } from "react";
import { stopExplorationAction } from "@/actions/explore";
import { Elapsed } from "@/components/elapsed";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ExplorerTile, FlowCover, LiveView } from "@/lib/explore";
import { plural } from "@/lib/format";

/** How long the big window stays on one explorer before it may jump to a busier one. */
const HOLD_MS = 8000;

const PHASES: ExplorePhase[] = ["setup", "planning", "exploring", "extracting", "proving", "confirming", "closing"];

const FEED_DOT: Record<ExploreFeedLine["kind"], string> = {
  note: "bg-border",
  pass: "bg-muted-foreground",
  test: "bg-foreground",
  wallet: "bg-live",
  error: "bg-warn",
  fail: "bg-bad",
  bug: "bg-bad",
};

function LiveDot() {
  return (
    <span className="relative flex size-2">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
      <span className="relative inline-flex size-2 rounded-full bg-live" />
    </span>
  );
}

function TimeLeft({ until }: { until: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const minutes = Math.ceil((new Date(until).getTime() - now) / 60_000);
  if (minutes <= 0) return null;
  return <span suppressHydrationWarning>{plural(minutes, "minute")} of exploring left</span>;
}

function Phases({ phase }: { phase: ExplorePhase }) {
  const at = PHASES.indexOf(phase);
  return (
    <ol aria-label="Stages" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {PHASES.map((p, i) => (
        <li key={p} aria-current={i === at ? "step" : undefined} className={cx("flex items-center gap-2", i === at ? "font-medium text-foreground" : i < at ? "text-muted-foreground" : "text-muted-foreground/50")}>
          {i > 0 && (
            <span aria-hidden="true" className="text-muted-foreground/40">
              ›
            </span>
          )}
          {EXPLORE_PHASE_LABEL[p]}
        </li>
      ))}
    </ol>
  );
}

function Count({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className={cx("text-2xl font-semibold tracking-tight tabular-nums", bad && value > 0 && "text-bad")}>{value}</span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

function Feed({ lines }: { lines: ExploreFeedLine[] }) {
  return (
    <ol aria-live="polite" className="flex min-h-0 flex-1 flex-col justify-end gap-2.5 overflow-hidden text-sm max-md:[&>li:nth-last-child(n+6)]:hidden md:[mask-image:linear-gradient(to_bottom,transparent,#000_3rem)]">
      {lines.map((l, i) => {
        const last = i === lines.length - 1;
        return (
          <li key={`${l.at}-${l.text}`} className="relative shrink-0 animate-in pl-4 duration-500 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none">
            <span aria-hidden="true" className={cx("absolute top-[7px] left-0 size-[7px] rounded-full", FEED_DOT[l.kind])} />
            <span className={cx("line-clamp-2 leading-snug break-words", !last && l.kind !== "bug" && "text-muted-foreground")}>{l.text}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Tile({ tile, focused, onPick }: { tile: ExplorerTile; focused: boolean; onPick: () => void }) {
  const running = tile.status === "running";
  return (
    <button type="button" aria-pressed={focused} onClick={onPick} className={cx("flex min-w-0 flex-col gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-muted/50", focused ? "border-foreground/40" : "border-border", !running && "opacity-70")}>
      <div className="relative aspect-[16/10] overflow-hidden rounded bg-muted">
        {tile.frame && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tile.frame} alt="" className="absolute inset-0 size-full object-cover object-top" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {running && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-live" />}
          <span className="truncate">{tile.title}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">{tile.status === "queued" ? "Waiting for a browser" : running ? (tile.doing ?? "Starting") : tile.status === "failed" ? "Couldn't finish" : tile.status === "stopped" ? "Stopped" : `${plural(tile.checks, "check")}${tile.bugs ? `, ${plural(tile.bugs, "bug")}` : ""}`}</span>
      </div>
    </button>
  );
}

/** One line per flow: how much of it has been covered so far. */
export function Coverage({ flows }: { flows: FlowCover[] }) {
  return (
    <ul className="flex flex-col divide-y">
      {flows.map((f) => (
        <li key={f.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2.5 text-sm">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="font-medium">{f.name}</span>
            <span className="text-xs text-muted-foreground">{TIER_LABEL[f.tier]}</span>
          </span>
          <span className="text-muted-foreground tabular-nums">
            {f.checks === 0 && !f.gap ? (
              "Nothing checked yet"
            ) : (
              <>
                {plural(f.checks, "check")}
                {f.tests > 0 && ` · ${plural(f.tests, "test")}`}
                {f.bugs > 0 && <span className="text-bad"> · {plural(f.bugs, "bug")}</span>}
              </>
            )}
          </span>
          {f.gap && <span className="basis-full text-muted-foreground">Not covered: {f.gap}</span>}
        </li>
      ))}
    </ul>
  );
}

/** The exploration as it happens: what one explorer sees, what they've all found, and how far it's got. */
export function ExploreLive({ view }: { view: LiveView }) {
  const [followed, setFollowed] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const since = useRef(0);

  // Tiles come busiest first, but cutting between explorers on every refresh is unwatchable.
  useEffect(() => {
    const current = view.explorers.find((e) => e.id === followed);
    const next = view.explorers.find((e) => e.status === "running") ?? view.explorers[0];
    if (!next || next.id === followed) return;
    if (current?.status === "running" && Date.now() - since.current < HOLD_MS) return;
    since.current = Date.now();
    setFollowed(next.id);
  }, [view, followed]);

  const pinned = view.explorers.find((e) => e.id === picked);
  const focus = pinned ?? view.explorers.find((e) => e.id === followed) ?? view.explorers[0];
  const queued = view.status === "queued";
  const { counts } = view;

  return (
    <section aria-label="Exploring the app in depth" className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2 className="text-xl font-semibold tracking-tight">Exploring in depth</h2>
            <span className="flex items-center gap-3 text-sm text-muted-foreground">
              <LiveDot />
              {view.startedAt ? <Elapsed since={view.startedAt} /> : "Queued"}
              {view.phase === "exploring" && view.deadline && <TimeLeft until={view.deadline} />}
            </span>
          </div>
          <form action={stopExplorationAction.bind(null, view.id)}>
            <Button type="submit" variant="outline" size="sm" disabled={view.stopping}>
              {view.stopping ? "Stopping…" : "Stop exploring"}
            </Button>
          </form>
        </div>
        <Phases phase={view.phase} />
      </header>

      <div className="grid gap-8 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] md:gap-10">
        <div className="flex min-w-0 flex-col gap-2">
          <BrowserWindow url={focus?.url ?? view.appUrl}>
            <div className="relative aspect-[16/10] overflow-hidden bg-card">
              {focus?.frame ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={focus.frame} alt={`What ${focus.title} sees right now`} className="absolute inset-0 size-full object-cover object-top" />
              ) : (
                <SiteLoading />
              )}
              <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border bg-background/85 px-3 py-2 text-sm shadow-md backdrop-blur-md">
                {!focus?.frame && <Spinner className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{focus?.status === "running" ? (focus.doing ?? focus.title) : queued ? "Waiting for a browser…" : `${EXPLORE_PHASE_LABEL[view.phase]}…`}</span>
              </div>
            </div>
          </BrowserWindow>
          <p className="flex min-h-5 items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="truncate">{focus?.title}</span>
            {pinned && (
              <button type="button" onClick={() => setPicked(undefined)} className="shrink-0 underline underline-offset-4 hover:text-foreground">
                Follow the action
              </button>
            )}
          </p>
        </div>

        {/* On wide screens the browser sets the height; old lines fade out of the top instead of growing the page. */}
        <div className="flex flex-col gap-6 md:h-0 md:min-h-full">
          <div className="grid grid-cols-4 gap-3">
            <Count label={counts.checks === 1 ? "check" : "checks"} value={counts.checks} />
            <Count label={counts.bugs === 1 ? "bug" : "bugs"} value={counts.bugs} bad />
            <Count label={counts.tests === 1 ? "test" : "tests"} value={counts.tests} />
            <Count label="dangerous" value={counts.dangerous} bad />
          </div>
          <Feed lines={view.feed} />
        </div>
      </div>

      {view.explorers.length > 1 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {view.explorers.map((e) => (
            <Tile key={e.id} tile={e} focused={e.id === focus?.id} onPick={() => setPicked(e.id === picked ? undefined : e.id)} />
          ))}
        </div>
      )}

      {view.flows.length > 0 && <Coverage flows={view.flows} />}
    </section>
  );
}
