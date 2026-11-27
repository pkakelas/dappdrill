"use client";

import { ChevronDown, Square } from "lucide-react";
import { useTransition } from "react";
import { stopMakeAction } from "@/actions/tests";
import { Elapsed } from "@/components/elapsed";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Latest, LiveFrame, Pulse } from "./live";
import { SaidNote } from "./said";
import { StateMark } from "./status";
import type { MakingItem } from "./test-item";

/**
 * A test being generated, on the line of the app's list it will take: what was asked for, what we are doing
 * right now, for how long, and the button that stops it. Opened, it shows our browser as it goes.
 * `now` is the server's clock when the page was made.
 */
export function MakingRow({ appUrl, item, open, onOpen, now }: { appUrl: string; item: MakingItem; open: boolean; onOpen: () => void; now: number }) {
  const [pending, start] = useTransition();
  const stopping = item.stopping || pending;
  const word = stopping ? "Stopping…" : item.queued ? "Queued" : "Generating";
  return (
    <li className="animate-in p-1.5 duration-500 fade-in-0 slide-in-from-top-2 motion-reduce:animate-none">
      <div className={cx("group/test relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors", open ? "items-start" : "hover:bg-foreground/[0.035]")}>
        {item.queued ? (
          <StateMark state="queued" label="Queued" size="lg" />
        ) : (
          <span role="img" aria-label="Generating" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600">
            <Spinner className="size-4" />
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`making-${item.id}`}
            onClick={onOpen}
            className={cx("min-w-0 cursor-pointer text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline", open ? "pt-1 text-pretty" : "max-sm:line-clamp-2 sm:truncate")}
          >
            {item.name}
          </button>
          {!open && <p className="truncate text-[13px] text-muted-foreground">{item.queued ? "Waiting for a browser" : (item.doing ?? "Opening your app")}</p>}
        </div>
        <span className={cx("flex shrink-0 items-center gap-2.5 text-xs tabular-nums", open && "h-7")}>
          <span className="hidden font-medium text-live sm:inline">{word}</span>
          {item.since && !item.queued && (
            <span className="hidden text-muted-foreground sm:inline">
              <Elapsed since={item.since} />
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={stopping}
            onClick={() => start(() => stopMakeAction(item.id))}
            aria-label={`Stop generating ${item.name}`}
            title="Stop"
            className="relative z-10 rounded-full text-live hover:text-live"
          >
            <Square className="size-3 fill-current" aria-hidden="true" />
          </Button>
          <ChevronDown aria-hidden="true" className={cx("pointer-events-none hidden size-4 text-muted-foreground/50 transition-transform sm:block", open && "rotate-180")} />
        </span>
      </div>

      {open && (
        <div id={`making-${item.id}`} className={cx("grid animate-in items-start gap-x-10 gap-y-6 px-2 pt-2 pb-3 duration-200 fade-in-0 motion-reduce:animate-none sm:pr-3 sm:pl-12", !item.queued && "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]")}>
          <div className="flex min-w-0 max-w-3xl flex-col gap-5">
            <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{item.goal}</p>
            {item.queued ? (
              <p className="text-sm text-pretty text-muted-foreground">Tests are generated one at a time. This one starts when the one before it is done.</p>
            ) : (
              <>
                {item.said && <SaidNote text={item.said} />}
                <Latest log={item.log} now={now} />
                <p className="text-xs text-pretty text-muted-foreground">We do it once in your app, write it down as steps, and keep it once it goes the same way twice. You can close this page.</p>
              </>
            )}
          </div>
          {!item.queued && (
            <aside className="min-w-0">
              <BrowserWindow url={appUrl} toolbar={item.taken && <Pulse at={item.taken} now={now} />}>
                <div className="relative aspect-[16/10] overflow-hidden bg-card">{item.frame ? <LiveFrame src={item.frame} /> : <SiteLoading />}</div>
              </BrowserWindow>
            </aside>
          )}
        </div>
      )}
    </li>
  );
}
