"use client";

import type { Done } from "@dappdrill/core";
import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { saidShort } from "./said";
import { LiveDot } from "./status";

/** From this long without a new picture, the browser counts as quiet. Pictures come every second or two while the page changes. */
const QUIET_MS = 15_000;

/** How many of the latest things done are listed. */
const LISTED = 5;

/** The time by the server's clock, ticking each second. `now` is that clock when the page was made, so a browser whose clock is off still counts right. */
function useNow(now: number): number {
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(now);
  useEffect(() => {
    setOffset(now - Date.now());
    setTick(now);
  }, [now]);
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now() + offset), 1000);
    return () => clearInterval(t);
  }, [offset]);
  return tick;
}

/** The latest picture of our browser, each one fading in over the one before as it arrives. */
export function LiveFrame({ src }: { src: string }) {
  const [layers, setLayers] = useState({ under: src, over: src });
  return (
    <>
      {/* The next picture loads out of sight, so the one showing never blanks. One that is gone by now is passed over. */}
      {src !== layers.over && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" aria-hidden="true" className="hidden" onLoad={() => setLayers((l) => ({ under: l.over, over: src }))} />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={layers.under} alt="" aria-hidden="true" className="absolute inset-0 size-full object-cover object-top" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img key={layers.over} src={layers.over} alt="What the browser sees right now" className="absolute inset-0 size-full animate-in object-cover object-top duration-500 fade-in motion-reduce:animate-none" />
    </>
  );
}

/**
 * Whether our browser is moving, in its window's bar: "Live" while pictures keep coming, and how long it has been
 * since the page last changed once they stop. `at` is when the latest picture was taken.
 */
export function Pulse({ at, now }: { at: number; now: number }) {
  const age = Math.max(0, useNow(now) - at);
  const quiet = age >= QUIET_MS;
  const s = Math.floor(age / 1000);
  return (
    <span suppressHydrationWarning className={cx("flex items-center gap-1.5 text-xs tabular-nums", quiet ? "text-muted-foreground" : "font-medium text-live")}>
      {quiet ? <span aria-hidden="true" className="size-2 rounded-full border-2 border-muted-foreground/50" /> : <LiveDot />}
      {quiet ? `No change for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "Live"}
    </span>
  );
}

const ago = (ms: number) => (ms < 5_000 ? "now" : ms < 60_000 ? `${Math.floor(ms / 1000)} s` : ms < 3_600_000 ? `${Math.floor(ms / 60_000)} min` : `${Math.floor(ms / 3_600_000)} h`);

/** The latest things done in our browser, newest first, each with how long ago. A new one fades in on top. */
export function Latest({ log, now }: { log: Done[]; now: number }) {
  const tick = useNow(now);
  if (log.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground">Latest steps</p>
      <ol className="flex flex-col gap-1.5">
        {log
          .slice(-LISTED)
          .reverse()
          .map((d, i) => (
            <li key={d.at + d.text} className="flex animate-in items-baseline justify-between gap-4 duration-300 fade-in motion-reduce:animate-none">
              <span title={d.text} className={cx("min-w-0 truncate", i > 0 && "text-muted-foreground")}>
                {saidShort(d.text)}
              </span>
              <span suppressHydrationWarning className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {ago(Math.max(0, tick - Date.parse(d.at)))}
              </span>
            </li>
          ))}
      </ol>
    </div>
  );
}
