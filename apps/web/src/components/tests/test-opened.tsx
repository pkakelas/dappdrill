"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { BrowserWindow } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { RunButton } from "./run-button";
import { StateMark } from "./status";
import type { Found, TestItem } from "./test-item";

/**
 * A test opened in its place in the list. What it is for comes first, across the whole width: a bug as what
 * was expected beside what the app did, any other test as its goal. Under that, its steps as one thread with
 * how each went, and beside them our browser with the run: the recording, or the page as it was after the
 * step being pointed at. Each of the two closes with what is done from it: the steps with the way to the
 * test's own page, the run with the button that does it again.
 */
export function TestOpened({ appId, appUrl, item, href }: { appId: string; appUrl: string; item: TestItem; href: string }) {
  const active = Boolean(item.now);
  const went = item.lines.filter((l) => l.state !== "never" && l.state !== "running");
  const passed = went.filter((l) => l.state === "passed").length;
  const steps = active ? <span className="text-live">{item.now}</span> : went.length === 0 ? undefined : passed === item.lines.length ? `All ${passed} passed` : `${passed} of ${item.lines.length} passed`;
  const paged = item.lines.some((l) => l.shot);
  const seen = Boolean(item.video || item.poster || paged);

  // The step whose page the browser shows: the one under the pointer, or else the one picked on the bar under the browser.
  const [pointed, setPointed] = useState<number>();
  const [picked, setPicked] = useState<number>();
  const at = [pointed, picked].find((i) => i !== undefined && item.lines[i]?.shot);
  const shot = at === undefined ? undefined : item.lines[at]!.shot;
  // The pages are fetched once the pointer comes near, so each is there by the time its step is pointed at.
  const fetched = useRef(false);
  const fetchPages = () => {
    if (fetched.current) return;
    fetched.current = true;
    for (const line of item.lines) if (line.shot) new window.Image().src = line.shot;
  };

  return (
    <div id={`lines-${item.id}`} className={cx("grid animate-in items-start gap-x-10 gap-y-6 px-2 pt-2 pb-3 duration-200 fade-in-0 motion-reduce:animate-none sm:pr-3 sm:pl-12", seen && "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]")}>
      <div className="col-span-full">{item.found ? <Finding found={item.found} bad={item.stands !== "unverified"} beside={seen} /> : <p className="max-w-3xl text-sm text-pretty text-muted-foreground">{item.goal}</p>}</div>

      <div className={cx("order-3 min-w-0 lg:order-2", !seen && "max-w-3xl")}>
        <Part title="Steps" aside={steps}>
          <ol className="-mx-2 flex flex-col text-sm" onMouseEnter={fetchPages} onMouseLeave={() => setPointed(undefined)}>
            {item.lines.map((line, i) => {
              const failed = line.tone === "bad";
              // After the line a run stopped at, the rest weren't done.
              const unreached = line.state === "never" && went.length > 0;
              return (
                <li key={line.key} className="relative" onMouseEnter={() => setPointed(i)}>
                  {/* The thread from this line's mark to the next one's. */}
                  {i < item.lines.length - 1 && <span aria-hidden="true" className="absolute top-[30px] -bottom-2 left-[17.5px] w-px bg-border" />}
                  <div className={cx("relative flex items-start gap-3 rounded-lg px-2 py-2 transition-colors", failed ? "bg-bad-soft" : line.tone === "warn" ? "bg-warn-soft" : at === i && "bg-foreground/[0.04]")}>
                    <StateMark state={line.state} label={line.label} className="mt-px" />
                    <span className="w-11 shrink-0 pt-[3px] text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{line.kind === "check" ? "Check" : "Do"}</span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className={cx("text-pretty [overflow-wrap:anywhere]", unreached && "text-muted-foreground")}>{line.text}</span>
                      {line.note && <span className={cx("text-pretty [overflow-wrap:anywhere]", failed ? "text-bad-ink" : line.tone === "warn" ? "text-warn-ink" : "text-muted-foreground")}>{line.note}</span>}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
          {item.stale && <p className="text-sm text-pretty text-muted-foreground">The test was edited after its last result, so the steps don&apos;t show how each went. Run it again.</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
            {!seen && <RunButton target={{ appId, testIds: [item.id] }} active={active} label="Run" size="sm" />}
            <Link href={href} className="group/open inline-flex items-center gap-1 text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:underline">
              Open the test
              <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover/open:translate-x-0.5 motion-reduce:transition-none" />
            </Link>
          </div>
        </Part>
      </div>

      {seen && (
        <aside className="order-2 min-w-0 lg:sticky lg:top-20 lg:order-3">
          <Part
            title={at !== undefined ? `After step ${at + 1}` : active ? "This run" : "Last run"}
            aside={
              picked !== undefined ? (
                <button type="button" onClick={() => setPicked(undefined)} className="cursor-pointer font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:underline">
                  {item.video ? "Back to the recording" : "Back to the last page"}
                </button>
              ) : at === undefined && paged ? (
                <span className="hidden sm:[@media(hover:hover)]:inline">Point at a step to see its page</span>
              ) : undefined
            }
          >
            <BrowserWindow url={appUrl}>
              <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                {item.video ? (
                  <video src={item.video} poster={item.poster ?? undefined} controls muted playsInline preload={item.poster ? "none" : "metadata"} aria-label="The last run" className="absolute inset-0 size-full bg-black object-contain" />
                ) : (
                  item.poster && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.poster} alt={active ? "The page at the last step done" : "The page at the end of the last run"} className="absolute inset-0 size-full object-cover object-top" />
                  )
                )}
                {shot && <Page key={shot} src={shot} alt={`The page after step ${at! + 1}`} />}
              </div>
            </BrowserWindow>
            <div role="group" aria-label="The page after each step" className="flex gap-0.5" onMouseEnter={fetchPages} onMouseLeave={() => setPointed(undefined)}>
              {item.lines.map((line, i) => (
                <button
                  key={line.key}
                  type="button"
                  disabled={!line.shot}
                  aria-pressed={picked === i}
                  aria-label={`Step ${i + 1}: ${line.text}`}
                  onMouseEnter={() => setPointed(i)}
                  onFocus={fetchPages}
                  onClick={() => setPicked(picked === i ? undefined : i)}
                  className="group/step flex-1 cursor-pointer py-1.5 outline-none disabled:cursor-default"
                >
                  <span
                    className={cx(
                      "block h-1 rounded-full transition-colors group-focus-visible/step:ring-2 group-focus-visible/step:ring-ring",
                      line.tone === "bad" ? "bg-bad-mid" : at === i ? "bg-foreground/70" : line.shot ? "bg-foreground/15" : "bg-foreground/[0.06]",
                    )}
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground tabular-nums">{active ? undefined : item.when}</span>
              <RunButton target={{ appId, testIds: [item.id] }} active={active} label="Run again" size="sm" quiet />
            </div>
          </Part>
        </aside>
      )}
    </div>
  );
}

/** The page after a step, over the recording once it has come: what was there stays in sight until then. */
function Page({ src, alt }: { src: string; alt: string }) {
  const [here, setHere] = useState(false);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} ref={(img) => void (img?.complete && setHere(true))} onLoad={() => setHere(true)} className={cx("absolute inset-0 size-full bg-background object-cover object-top", !here && "opacity-0")} />
  );
}

/**
 * What the last run found. A bug reads as its heading over two tiles, what a user should get and what the
 * app did, so the difference is seen before it is read. What no single line explains is one tile.
 * `beside`: the steps have the browser beside them, and the two tiles stand on the same two columns.
 */
function Finding({ found, bad, beside }: { found: Found; bad: boolean; beside: boolean }) {
  const soft = bad ? "bg-bad-soft" : "bg-warn-soft";
  const ink = bad ? "text-bad" : "text-warn";
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {found.title && <p className="text-[15px]/6 font-semibold text-pretty text-bad-ink">{found.title}</p>}
      {found.why ? (
        <div className={cx("flex max-w-3xl flex-col gap-1 rounded-lg px-3.5 py-3 text-sm", soft)}>
          <span className={cx("text-xs font-medium", ink)}>{bad ? "Why it failed" : "Why it couldn't be verified"}</span>
          <p className="[overflow-wrap:anywhere]">{found.why}</p>
        </div>
      ) : (
        <dl className={cx("grid gap-2 text-sm sm:grid-cols-2", beside ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-x-10" : "max-w-3xl")}>
          {found.expected && (
            <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-muted/60 px-3.5 py-3">
              <dt className="text-xs font-medium text-muted-foreground">Expected</dt>
              <dd className="[overflow-wrap:anywhere]">{found.expected}</dd>
            </div>
          )}
          {found.saw && (
            <div className={cx("flex min-w-0 flex-col gap-1 rounded-lg px-3.5 py-3", soft)}>
              <dt className={cx("text-xs font-medium", ink)}>What the app did</dt>
              <dd className="[overflow-wrap:anywhere]">{found.saw}</dd>
            </div>
          )}
        </dl>
      )}
    </section>
  );
}

/** One part of an opened test: what it is, a few words beside that, and the part itself. */
function Part({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
