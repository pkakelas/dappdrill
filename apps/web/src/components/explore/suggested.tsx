import { ACTIVE_LABEL, SETTLED_LABEL } from "@dappdrill/core";
import Link from "next/link";
import { Line } from "@/components/tests/condition-branches";
import { RunButton } from "@/components/tests/run-button";
import { STATE_TEXT } from "@/components/tests/status";
import { cx } from "@/components/ui";
import { Skeleton } from "@/components/ui/skeleton";
import type { SuggestedTest } from "@/lib/explore";
import { AddSuggested } from "./controls";

type Now = "trying" | "waiting" | undefined;

/** A test that isn't one yet: a dashed outline where a result would be, filled while something is working on it. */
function Mark({ now }: { now?: Now }) {
  return (
    <span aria-hidden="true" className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed", now ? "border-live/40 bg-live-soft" : "border-foreground/20")}>
      {now === "trying" && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-live" />
        </span>
      )}
      {now === "waiting" && <span className="size-2 rounded-full bg-live" />}
    </span>
  );
}

const NOW_LABEL = { trying: "Trying now", worked: "Worked once" } as const;

/**
 * Tests that haven't run yet: in queue while the pass runs, since it tries each one, and they move
 * up into the list as they pass. Once it ends, what is left is suggested, yours to add. One you add runs right here, and moves up as soon as its run
 * says something: passed, failed, or needs you.
 */
export function Suggested({ appId, tests, passId, running }: { appId: string; tests: SuggestedTest[]; passId: string; running: boolean }) {
  if (tests.length === 0) return null;
  return (
    <section aria-labelledby="suggested" className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="suggested" className="text-sm font-medium">
            {running ? "In queue" : "Suggested"} <span className="font-normal text-muted-foreground tabular-nums">{tests.length}</span>
          </h2>
          <p className="text-sm text-muted-foreground">{running ? "Each one becomes a test when it passes on a clean fork." : "Not run yet. Add one and it runs right away."}</p>
        </div>
        {!running && tests.filter((t) => !t.added).length > 1 && <AddSuggested passId={passId} label="Add all" />}
      </div>
      <ul className="divide-y divide-dashed rounded-xl border border-dashed">
        {tests.map((t) => {
          // Once the pass has ended nothing is being tried: what worked for an explorer is only a fact about it.
          const now = running ? t.now : undefined;
          const run = t.added;
          const mark: Now = run ? (run.active === "running" ? "trying" : run.active && "waiting") : now === "worked" ? "waiting" : now;
          return (
            <li key={t.id} className="p-1.5">
              <Line
                className="min-h-11 py-2"
                mark={<Mark now={mark} />}
                name={
                  <div className="flex min-w-0 flex-col gap-0.5">
                    {run ? (
                      <Link href={`/apps/${appId}/tests/${run.testId}`} className="min-w-0 text-pretty outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline">
                        {t.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 text-pretty">{t.name}</span>
                    )}
                    {(run ? !run.active && (run.why ?? t.note) : !now && t.note) && <span className="truncate text-xs text-muted-foreground">{run?.why ?? t.note}</span>}
                  </div>
                }
                status={
                  <span className="flex items-center gap-2">
                    {run ? (
                      run.active ? (
                        <span className="text-live">{ACTIVE_LABEL[run.active]}</span>
                      ) : (
                        <span className={STATE_TEXT[run.settled]}>{SETTLED_LABEL[run.settled]} ·</span>
                      )
                    ) : now ? (
                      <span className="text-live">{NOW_LABEL[now]}</span>
                    ) : (
                      t.now === "worked" && <span>Worked once ·</span>
                    )}
                    <span>{t.feature}</span>
                  </span>
                }
                action={run ? <RunButton target={{ appId, testIds: [run.testId] }} active={Boolean(run.active)} stopIds={[run.testId]} label="Run test" /> : !running && <AddSuggested passId={passId} id={t.id} label="Add" />}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const PLACEHOLDER_WIDTHS = ["w-56", "w-72", "w-44"];

/** The shape of the list while the pass is still looking around, so the page isn't bare and doesn't jump when the tests arrive. */
export function SuggestedPlaceholder() {
  return (
    <section aria-labelledby="suggested" className="flex flex-col gap-2">
      <div className="flex min-h-8 flex-wrap items-baseline gap-x-2 px-1">
        <h2 id="suggested" className="text-sm font-medium">
          In queue
        </h2>
        <p className="text-sm text-muted-foreground">The tests worth trying are listed here in a minute or two.</p>
      </div>
      <ul aria-hidden="true" className="divide-y divide-dashed rounded-xl border border-dashed">
        {PLACEHOLDER_WIDTHS.map((width) => (
          <li key={width} className="p-1.5">
            <div className="flex min-h-11 items-center gap-3 px-2 py-2">
              <Mark />
              <Skeleton className={cx("h-4 max-w-full", width)} />
              <Skeleton className="ml-auto h-3 w-20 max-sm:hidden" />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
