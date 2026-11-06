"use client";

import { EXPLORE_PHASE_LABEL, type ExploreFeedLine } from "@dappdrill/core";
import { useEffect, useRef, useState } from "react";
import { stopExplorationAction } from "@/actions/explore";
import { Elapsed } from "@/components/elapsed";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ExplorerTile, LiveView } from "@/lib/explore";
import { plural } from "@/lib/format";

/** How long the big window stays on one explorer before it may jump to a busier one. */
const HOLD_MS = 8000;

const FEED_DOT: Record<ExploreFeedLine["kind"], string> = {
  note: "bg-border",
  pass: "bg-good",
  test: "bg-good",
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
  return <span suppressHydrationWarning>· {plural(minutes, "minute")} left</span>;
}

/** Newest first, right under the headline; older lines fade out at the bottom instead of growing the page. */
function Feed({ lines }: { lines: ExploreFeedLine[] }) {
  return (
    <ol aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden text-sm max-md:[&>li:nth-child(n+6)]:hidden md:[mask-image:linear-gradient(to_top,transparent,#000_3rem)]">
      {[...lines].reverse().map((l, i) => (
        <li key={`${l.at}-${l.text}`} className="relative shrink-0 animate-in pl-4 duration-500 fade-in-0 slide-in-from-top-1 motion-reduce:animate-none">
          <span aria-hidden="true" className={cx("absolute top-[7px] left-0 size-[7px] rounded-full", FEED_DOT[l.kind])} />
          <span className={cx("line-clamp-2 leading-snug break-words", i > 0 && l.kind !== "bug" && "text-muted-foreground")}>{l.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Thumb({ tile, focused, onPick }: { tile: ExplorerTile; focused: boolean; onPick: () => void }) {
  return (
    <button type="button" aria-pressed={focused} title={tile.doing ?? tile.title} onClick={onPick} className={cx("flex w-32 shrink-0 flex-col gap-1 rounded-lg border p-1 text-left transition-colors hover:bg-foreground/5", focused ? "border-foreground/40" : "border-border")}>
      <div className="relative aspect-[16/10] overflow-hidden rounded bg-muted">
        {tile.frame && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tile.frame} alt="" className="absolute inset-0 size-full object-cover object-top" />
        )}
      </div>
      <span className="truncate px-0.5 text-xs">{tile.title}</span>
    </button>
  );
}

const HEADLINE: Record<LiveView["phase"], string> = {
  looking: "Finding what to test",
  setup: "Checking the setup",
  exploring: "Trying the tests",
  finishing: "Finishing up",
  done: "Finishing up",
};

const DETAIL: Record<LiveView["phase"], string> = {
  looking: "Tests show up below once they pass on a clean fork.",
  setup: "The steps every test starts from have to work first.",
  exploring: "Each feature has its own browser. A test is saved once it passes again on a clean fork.",
  finishing: "Waiting for the last tests and bug reviews.",
  done: "Waiting for the last tests and bug reviews.",
};

/** The pass as it happens: what one browser sees, and what they've all found so far. */
export function PassBand({ view }: { view: LiveView }) {
  const [followed, setFollowed] = useState<string>();
  const [picked, setPicked] = useState<string>();
  const since = useRef(0);

  // Tiles come busiest first, but cutting between browsers on every refresh is unwatchable.
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
  const running = view.explorers.filter((e) => e.status === "running");
  const { counts } = view;

  return (
    <section aria-label="Exploring the app" className="flex flex-col gap-4">
      <div className="grid gap-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-10">
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

        {/* On wide screens the browser sets the height. */}
        <div className="flex flex-col gap-6 md:h-0 md:min-h-full md:py-1">
          <div className="flex flex-col gap-2">
            <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
              <span className="flex flex-wrap items-center gap-x-2">
                <LiveDot />
                {queued ? "Queued" : EXPLORE_PHASE_LABEL[view.phase]}
                {view.startedAt && (
                  <>
                    {" · "}
                    <Elapsed since={view.startedAt} />
                  </>
                )}
                {view.phase === "exploring" && view.deadline && <TimeLeft until={view.deadline} />}
              </span>
              <form action={stopExplorationAction.bind(null, view.id)}>
                <Button type="submit" variant="outline" size="sm" disabled={view.stopping}>
                  {view.stopping ? "Stopping…" : "Stop"}
                </Button>
              </form>
            </div>
            <h2 className="text-xl font-semibold tracking-tight">{queued ? "Waiting for a browser" : HEADLINE[view.phase]}</h2>
            {counts.tried > 0 ? (
              <p className="text-sm text-muted-foreground tabular-nums">
                {counts.tried} tried · {plural(counts.tests, "test")} saved{counts.bugs > 0 && <span className="text-bad"> · {plural(counts.bugs, "bug")}</span>}
              </p>
            ) : (
              <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{DETAIL[view.phase]}</p>
            )}
          </div>
          <Feed lines={view.feed} />
        </div>
      </div>

      {running.length > 1 && (
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {running.map((e) => (
            <Thumb key={e.id} tile={e} focused={e.id === focus?.id} onPick={() => setPicked(e.id === picked ? undefined : e.id)} />
          ))}
          {pinned && (
            <button type="button" onClick={() => setPicked(undefined)} className="shrink-0 px-2 text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Follow the action
            </button>
          )}
        </div>
      )}
    </section>
  );
}
