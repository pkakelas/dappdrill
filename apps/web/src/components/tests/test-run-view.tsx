"use client";

import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { cx } from "@/components/ui";
import { Evidence } from "./signed";
import { StateMark, type TestState } from "./status";

/** One line of the test as the run on screen left it, ready to draw. */
export interface ViewLine {
  key: string;
  kind: "action" | "check";
  text: string;
  state: TestState;
  label: string;
  note?: string;
  tone?: "bad" | "warn" | "quiet";
  redone?: string;
  did?: string[];
  shot?: string | null;
}

const TONE = { bad: "text-bad", warn: "text-warn", quiet: "text-muted-foreground" };

/**
 * The run on screen: its lines down the left as one thread, and our browser on the right showing the
 * whole run as video or the page at the line picked. A run in progress shows the live page instead.
 */
export function TestRunView({
  appUrl,
  startPath,
  lines,
  cleanup,
  video,
  poster,
  live,
  stale,
  pick,
  children,
}: {
  appUrl: string;
  startPath: string;
  lines: ViewLine[];
  cleanup?: { lines: ViewLine[]; status: string; open: boolean };
  video?: string | null;
  poster?: string | null;
  /** While a run is on: the page it is on now, or null before it has one. */
  live?: { frame: string | null; queued: boolean };
  /** The lines were edited after this result. */
  stale?: boolean;
  /** The line shown first: where the run went wrong, when it did. */
  pick?: string;
  /** What goes under the lines: the signatures. */
  children?: ReactNode;
}) {
  const all = [...lines, ...(cleanup?.lines ?? [])];
  const [picked, setPicked] = useState<string | undefined>(pick ?? (video ? undefined : all.findLast((l) => l.shot)?.key));
  const at = all.findIndex((l) => l.key === picked);
  const line = at >= 0 ? all[at] : undefined;
  const step = (by: number) => {
    for (let i = at + by; i >= 0 && i < all.length; i += by) if (all[i]!.shot) return setPicked(all[i]!.key);
  };
  const row = (l: ViewLine, i: number, list: ViewLine[]) => <Row key={l.key} line={l} last={i === list.length - 1} picked={l.key === picked} onPick={live ? undefined : () => setPicked(l.key === picked && video ? undefined : l.key)} />;

  return (
    <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
      <div className="flex min-w-0 flex-col gap-10">
        <section aria-label="Lines" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 px-2">
            <h2 className="text-sm font-medium">Lines</h2>
            <span className="text-xs text-muted-foreground">
              Starts on <span className="font-mono">{startPath}</span>
            </span>
          </div>
          <ol className="flex flex-col">{lines.map(row)}</ol>
          {stale && <p className="px-2 text-sm text-pretty text-muted-foreground">The test was edited after this result, so the lines don&apos;t show how each went. Run it again.</p>}
          {cleanup && cleanup.lines.length > 0 && (
            <details open={cleanup.open} className="group/cleanup px-0">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 transition-transform group-open/cleanup:rotate-90" aria-hidden="true" />
                <span className="font-medium">Cleanup</span>
                <span>· puts the account back afterwards{cleanup.status}</span>
              </summary>
              <ol className="mt-2 flex flex-col">{cleanup.lines.map(row)}</ol>
            </details>
          )}
        </section>
        {children}
      </div>

      <aside aria-label="What the browser saw" className="order-first flex min-w-0 flex-col gap-3 lg:sticky lg:top-20 lg:order-none">
        <BrowserWindow
          url={appUrl}
          toolbar={
            live ? (
              <span className="flex items-center gap-1.5 text-xs text-live">
                <span className="size-1.5 animate-pulse rounded-full bg-live motion-reduce:animate-none" />
                Live
              </span>
            ) : (
              video && (
                <div className="flex rounded-md bg-background p-0.5 text-xs">
                  <Seg on={!line} onClick={() => setPicked(undefined)}>
                    Video
                  </Seg>
                  <Seg on={Boolean(line)} onClick={() => setPicked(line?.key ?? all.find((l) => l.shot)?.key)}>
                    Lines
                  </Seg>
                </div>
              )
            )
          }
        >
          <div className="relative aspect-[16/10] overflow-hidden bg-muted">
            {live ? (
              live.frame ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={live.frame} alt="The test running now" className="absolute inset-0 size-full object-cover object-top" />
              ) : (
                <>
                  <SiteLoading />
                  <p className="absolute inset-x-0 bottom-4 text-center text-sm text-muted-foreground">{live.queued ? "Waiting for a browser…" : "Opening the app…"}</p>
                </>
              )
            ) : line ? (
              line.shot ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={line.key} src={line.shot} alt={`The page at line ${at + 1}`} className="absolute inset-0 size-full animate-in object-cover object-top duration-200 fade-in-0" />
              ) : (
                <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">No picture of the page at this line.</p>
              )
            ) : video ? (
              <video key={video} src={video} poster={poster ?? undefined} controls muted playsInline className="absolute inset-0 size-full bg-black object-contain" />
            ) : (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Not run yet.</p>
            )}
          </div>
        </BrowserWindow>

        {!live && line && (
          <div className="flex items-start gap-3 px-1">
            <StateMark state={line.state} label={line.label} className="mt-0.5" />
            <p className="min-w-0 flex-1 text-sm text-pretty">
              <span className="text-muted-foreground">{at < lines.length ? `Line ${at + 1}` : "Cleanup"} · </span>
              {line.text}
            </p>
            <div className="flex shrink-0">
              <Nav label="Previous line" disabled={!all.slice(0, at).some((l) => l.shot)} onClick={() => step(-1)}>
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Nav>
              <Nav label="Next line" disabled={!all.slice(at + 1).some((l) => l.shot)} onClick={() => step(1)}>
                <ChevronRight className="size-4" aria-hidden="true" />
              </Nav>
            </div>
          </div>
        )}
        {!live && !line && video && <p className="px-1 text-sm text-muted-foreground">The whole run. Pick a line to see the page at that point.</p>}
      </aside>
    </div>
  );
}

/** A line on the thread: its mark, Do or Check, its words, and what the run found. Picking it shows its page. */
function Row({ line, last, picked, onPick }: { line: ViewLine; last: boolean; picked: boolean; onPick?: () => void }) {
  const body = (
    <>
      <StateMark state={line.state} label={line.label} className="mt-px" />
      <span className="w-11 shrink-0 pt-[3px] text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{line.kind === "check" ? "Check" : "Do"}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-pretty">{line.text}</span>
        {/* What a passing check saw shows once its line is picked (folded when it can't be); a problem always shows whole. */}
        {line.note && (line.tone !== "quiet" || picked || !line.shot) && (
          <Evidence text={line.note} className="mt-0.5 text-sm" textClassName={cx("text-pretty [overflow-wrap:anywhere]", TONE[line.tone ?? "quiet"], !picked && line.tone === "quiet" && "line-clamp-2")} />
        )}
        {line.redone && <span className="text-sm text-pretty text-muted-foreground">The recorded actions stopped working, so it was worked out again: {line.redone}</span>}
        {line.did && line.did.length > 0 && <span className="text-xs text-pretty text-muted-foreground [overflow-wrap:anywhere]">{line.did.join(" · ")}</span>}
      </span>
      {line.shot && onPick && <ImageIcon className={cx("mt-1 size-3.5 shrink-0 text-muted-foreground transition-opacity", picked ? "opacity-100" : "opacity-0 group-hover/row:opacity-100")} aria-hidden="true" />}
    </>
  );
  const box = cx("group/row relative z-10 flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left", picked && "bg-foreground/[0.06]");
  return (
    <li className="relative">
      {/* The thread from this line's mark to the next one's. */}
      {!last && <span aria-hidden="true" className="absolute top-[34px] -bottom-2 left-[17.5px] w-px bg-border" />}
      {onPick && line.shot ? (
        <button type="button" aria-pressed={picked} onClick={onPick} className={cx(box, "transition-colors outline-none hover:bg-foreground/[0.04] focus-visible:ring-2 focus-visible:ring-ring")}>
          {body}
        </button>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={cx("rounded px-2 py-0.5 transition-colors", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
      {children}
    </button>
  );
}

function Nav({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-foreground/5 hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}
