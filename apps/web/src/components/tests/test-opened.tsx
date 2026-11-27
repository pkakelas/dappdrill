"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrowserWindow } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { RunButton } from "./run-button";
import { StateMark } from "./status";
import type { Found, TestItem } from "./test-item";

/**
 * A test opened in its place in the list. A bug it found comes first, as what was expected beside what the
 * app did; any other test says its goal there. Then its steps as one thread with how each went, the one a
 * run stopped at standing out, and that run in our browser beside them.
 */
export function TestOpened({ appId, appUrl, item, href }: { appId: string; appUrl: string; item: TestItem; href: string }) {
  const active = Boolean(item.now);
  const went = item.lines.filter((l) => l.state !== "never" && l.state !== "running");
  const passed = went.filter((l) => l.state === "passed").length;
  const steps = active ? <span className="text-live">{item.now}</span> : went.length === 0 ? undefined : passed === item.lines.length ? `All ${passed} passed` : `${passed} of ${item.lines.length} passed`;
  const seen = Boolean(item.video || item.poster);

  return (
    <div id={`lines-${item.id}`} className={cx("grid animate-in items-start gap-x-10 gap-y-6 px-2 pt-2 pb-3 duration-200 fade-in-0 motion-reduce:animate-none sm:pr-3 sm:pl-12", seen && "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]")}>
      <div className={cx("flex min-w-0 flex-col gap-6", !seen && "max-w-3xl")}>
        {item.found ? <Finding found={item.found} bad={item.stands !== "unverified"} /> : <p className="max-w-2xl text-sm text-pretty text-muted-foreground">{item.goal}</p>}

        <Part title="Steps" aside={steps}>
          <ol className="-mx-2 flex flex-col text-sm">
            {item.lines.map((line, i) => {
              const failed = line.tone === "bad";
              // After the line a run stopped at, the rest weren't done.
              const unreached = line.state === "never" && went.length > 0;
              return (
                <li key={line.key} className="relative">
                  {/* The thread from this line's mark to the next one's. */}
                  {i < item.lines.length - 1 && <span aria-hidden="true" className="absolute top-[30px] -bottom-2 left-[17.5px] w-px bg-border" />}
                  <div className={cx("relative flex items-start gap-3 rounded-lg px-2 py-2", failed && "bg-bad-soft", line.tone === "warn" && "bg-warn-soft")}>
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
        </Part>
      </div>

      {seen && (
        <aside className="min-w-0 lg:sticky lg:top-20">
          <Part title={active ? "This run" : "Last run"} aside={active ? undefined : <span className="sm:hidden">{item.when}</span>}>
            <BrowserWindow url={appUrl}>
              <div className="relative aspect-[16/10] overflow-hidden bg-muted">
                {item.video ? (
                  <video src={item.video} poster={item.poster ?? undefined} controls muted playsInline preload={item.poster ? "none" : "metadata"} aria-label="The last run" className="absolute inset-0 size-full bg-black object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.poster!} alt={active ? "The page at the last step done" : "The page at the end of the last run"} className="absolute inset-0 size-full object-cover object-top" />
                )}
              </div>
            </BrowserWindow>
          </Part>
        </aside>
      )}

      <div className="col-span-full flex flex-wrap items-center gap-2">
        <RunButton target={{ appId, testIds: [item.id] }} active={active} label="Run" size="sm" />
        <Button asChild variant="outline" size="sm">
          <Link href={href}>
            Open the test
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * What the last run found. A bug reads as its heading over two tiles, what a user should get and what the
 * app did, so the difference is seen before it is read. What no single line explains is one tile.
 */
function Finding({ found, bad }: { found: Found; bad: boolean }) {
  const soft = bad ? "bg-bad-soft" : "bg-warn-soft";
  const ink = bad ? "text-bad" : "text-warn";
  return (
    <section className="flex min-w-0 flex-col gap-3">
      {found.title && <p className="max-w-2xl text-[15px]/6 font-semibold text-pretty text-bad-ink">{found.title}</p>}
      {found.why ? (
        <div className={cx("flex flex-col gap-1 rounded-lg px-3.5 py-3 text-sm", soft)}>
          <span className={cx("text-xs font-medium", ink)}>{bad ? "Why it failed" : "Why it couldn't be verified"}</span>
          <p className="[overflow-wrap:anywhere]">{found.why}</p>
        </div>
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
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
