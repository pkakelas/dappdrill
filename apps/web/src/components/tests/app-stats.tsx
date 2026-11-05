import { VERDICT_LABEL, type TestRunStatus, type Verdict } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { duration, plural, shortDate } from "@/lib/format";
import { StateMark, type TestState } from "./status";

/** How far back the stats look, and how many marks the small charts draw. */
export const HISTORY_DAYS = 14;

const PASS = "bg-foreground/25";
const DAY = 24 * 60 * 60 * 1000;

/** The band at the top of an app: is it OK, is it getting better, and what did it sign. */
export function AppStats({ states, conditionsFailed, runs }: { states: TestState[]; conditionsFailed: number; runs: RunSummary[] }) {
  return (
    <section aria-label="How the app is doing" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-xs lg:grid-cols-4">
      <TestsNow states={states} conditionsFailed={conditionsFailed} />
      <PassRate runs={runs} />
      <Signatures runs={runs} />
      <RunTime runs={runs} />
    </section>
  );
}

function Tile({ label, value, mark, caption, children }: { label: string; value: ReactNode; mark?: ReactNode; caption: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-card p-4 sm:p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="mt-1.5 flex items-center gap-2 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl">
        {mark}
        <span className="min-w-0">{value}</span>
      </span>
      <span className="mt-0.5 text-sm text-muted-foreground">{caption}</span>
      <div className="mt-auto flex h-12 items-end pt-4">{children}</div>
    </div>
  );
}

/** One whole split into parts. A part at zero draws nothing. */
function Segments({ parts, label }: { parts: { count: number; className: string }[]; label: string }) {
  const shown = parts.filter((p) => p.count > 0);
  return (
    <div role="img" aria-label={label} title={label} className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
      {shown.map((p, i) => (
        <span key={i} className={cx("h-full", p.className)} style={{ flexGrow: p.count }} />
      ))}
    </div>
  );
}

function TestsNow({ states, conditionsFailed }: { states: TestState[]; conditionsFailed: number }) {
  const count = (...of: TestState[]) => states.filter((s) => of.includes(s)).length;
  const failed = count("fail");
  const stuck = count("error");
  const passed = count("pass");
  const active = count("running", "queued", "drafting");
  const value = failed ? `${failed} failing` : stuck ? `${stuck} couldn't run` : active ? `${active} running` : passed === states.length ? "All passing" : passed ? `${passed} passing` : "Not run yet";
  const mark = failed ? <StateMark state="fail" /> : stuck ? <StateMark state="error" /> : null;
  const rest = states.length - failed - stuck - passed - active;
  return (
    <Tile label="Right now" value={value} mark={mark} caption={[`of ${plural(states.length, "test")}`, conditionsFailed > 0 && `${plural(conditionsFailed, "condition")} failed`].filter(Boolean).join(", ")}>
      <Segments
        label={[`${passed} passed`, `${failed} failed`, `${stuck} couldn't run`, `${active} running`, `${rest} not run yet`].filter((t) => !t.startsWith("0 ")).join(", ")}
        parts={[
          { count: failed, className: "bg-bad" },
          { count: stuck, className: "bg-warn-bar" },
          { count: active, className: "bg-live" },
          { count: passed, className: PASS },
        ]}
      />
    </Tile>
  );
}

/** A slot per day, oldest first. */
function byDay(runs: RunSummary[], now = Date.now()) {
  const today = Math.floor(now / DAY);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => ({ date: new Date((today - HISTORY_DAYS + 1 + i) * DAY), passed: 0, failed: 0 }));
  for (const r of runs) {
    const day = days[Math.floor(r.createdAt.getTime() / DAY) - today + HISTORY_DAYS - 1];
    if (day && r.status === "pass") day.passed++;
    if (day && r.status === "fail") day.failed++;
  }
  return days;
}

function PassRate({ runs }: { runs: RunSummary[] }) {
  const days = byDay(runs);
  const passed = days.reduce((n, d) => n + d.passed, 0);
  const total = passed + days.reduce((n, d) => n + d.failed, 0);
  const busiest = Math.max(1, ...days.map((d) => d.passed + d.failed));
  return (
    <Tile label="Pass rate" value={total ? `${Math.round((passed / total) * 100)}%` : "–"} caption={total ? `${passed} of ${plural(total, "run")}, ${HISTORY_DAYS} days` : `No runs in ${HISTORY_DAYS} days`}>
      <TooltipProvider>
        <div role="img" aria-label={`${passed} of ${total} runs passed in the last ${HISTORY_DAYS} days`} className="flex h-full w-full items-end gap-0.5">
          {days.map((d) => {
            const runsThatDay = d.passed + d.failed;
            return (
              <Tooltip key={d.date.getTime()}>
                <TooltipTrigger asChild>
                  <span className="flex h-full min-w-0 flex-1 flex-col justify-end hover:opacity-70">
                    {runsThatDay === 0 ? (
                      <span className="h-1 rounded-full bg-muted" />
                    ) : (
                      <span className="flex flex-col gap-px overflow-hidden rounded-t-[3px]" style={{ height: `${Math.max(25, (runsThatDay / busiest) * 100)}%` }}>
                        {d.failed > 0 && <span className="min-h-1 bg-bad" style={{ flexGrow: d.failed }} />}
                        {d.passed > 0 && <span className={cx("min-h-1", PASS)} style={{ flexGrow: d.passed }} />}
                      </span>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <span className="font-medium">{shortDate(d.date)}</span> · {runsThatDay ? `${d.passed} passed, ${d.failed} failed` : "No runs"}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </Tile>
  );
}

function Signatures({ runs }: { runs: RunSummary[] }) {
  const verdicts = runs.flatMap((r) => r.verdicts);
  const count = (v: Verdict) => verdicts.filter((x) => x === v).length;
  const dangerous = count("dangerous");
  const check = count("check");
  const consistent = count("consistent");
  const flagged = [dangerous && `${dangerous} ${VERDICT_LABEL.dangerous.toLowerCase()}`, check && `${check} to check`].filter(Boolean).join(", ");
  return (
    <Tile
      label="Signatures reviewed"
      value={verdicts.length}
      mark={dangerous ? <StateMark state="fail" /> : check ? <StateMark state="error" /> : null}
      caption={flagged || (verdicts.length ? "All look consistent" : `None in ${HISTORY_DAYS} days`)}
    >
      <Segments
        label={`${dangerous} dangerous, ${check} to check, ${consistent} look consistent`}
        parts={[
          { count: dangerous, className: "bg-bad" },
          { count: check, className: "bg-warn-bar" },
          { count: consistent, className: PASS },
        ]}
      />
    </Tile>
  );
}

const FINISHED: TestRunStatus[] = ["pass", "fail"];

function RunTime({ runs }: { runs: RunSummary[] }) {
  // Runs come newest first; the chart reads left to right, oldest first.
  const times = runs
    .filter((r) => FINISHED.includes(r.status) && r.startedAt && r.finishedAt)
    .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime())
    .slice(0, HISTORY_DAYS)
    .reverse();
  const sorted = [...times].sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)];
  const slowest = sorted.at(-1) ?? 1;
  const empty = HISTORY_DAYS - times.length;
  return (
    <Tile label="Typical run" value={typical === undefined ? "–" : duration(typical)} caption={typical === undefined ? "No runs yet" : `Slowest ${duration(slowest)}`}>
      <div role="img" aria-label={`The last ${plural(times.length, "run")}, by how long each took`} className="flex h-full w-full items-end gap-0.5">
        {Array.from({ length: empty }, (_, i) => (
          <span key={i} className="h-1 min-w-0 flex-1 rounded-full bg-muted" />
        ))}
        {times.map((t, i) => (
          <span key={i} title={duration(t)} className={cx("min-w-0 flex-1 rounded-t-[3px] hover:opacity-70", PASS)} style={{ height: `${Math.max(12, (t / slowest) * 100)}%` }} />
        ))}
      </div>
    </Tile>
  );
}

/** A test's recent runs, oldest first, so a flaky test looks flaky at a glance. */
export function RunTicks({ runs, slots = 8 }: { runs: RunSummary[]; slots?: number }) {
  const recent = runs.slice(0, slots).reverse();
  if (recent.length === 0) return null;
  const count = (status: TestRunStatus) => recent.filter((r) => r.status === status).length;
  const label = `Last ${plural(recent.length, "run")}: ${[`${count("pass")} passed`, `${count("fail")} failed`, `${count("error")} couldn't run`].filter((t) => !t.startsWith("0 ")).join(", ")}`;
  return (
    <span role="img" aria-label={label} title={label} className="flex h-3.5 items-end gap-0.5">
      {Array.from({ length: slots - recent.length }, (_, i) => (
        <span key={i} className="h-1 w-1 rounded-full bg-muted" />
      ))}
      {recent.map((r) => (
        <span key={r.id} className={cx("h-full w-1 rounded-full", r.status === "fail" ? "bg-bad" : r.status === "error" ? "bg-warn-bar" : PASS)} />
      ))}
    </span>
  );
}
