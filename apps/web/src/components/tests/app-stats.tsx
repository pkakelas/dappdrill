import type { TestRunStatus } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { cx } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { duration, plural, shortDate } from "@/lib/format";

/** How far back the chart looks. */
export const HISTORY_DAYS = 14;

const PASS = "bg-foreground/20";
const DAY = 24 * 60 * 60 * 1000;

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

const FINISHED: TestRunStatus[] = ["pass", "fail"];

function typicalRun(runs: RunSummary[]) {
  const times = runs
    .filter((r) => FINISHED.includes(r.status) && r.startedAt && r.finishedAt)
    .map((r) => r.finishedAt!.getTime() - r.startedAt!.getTime())
    .sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

/** Is the app getting better: a bar per day, with what was signed and how long a run takes under it. */
export function RunHistory({ runs }: { runs: RunSummary[] }) {
  const days = byDay(runs);
  const passed = days.reduce((n, d) => n + d.passed, 0);
  const total = passed + days.reduce((n, d) => n + d.failed, 0);
  const busiest = Math.max(1, ...days.map((d) => d.passed + d.failed));
  const signatures = runs.flatMap((r) => r.verdicts).length;
  const typical = typicalRun(runs);
  return (
    <section aria-label={`The last ${HISTORY_DAYS} days`} className="flex flex-col gap-3 text-sm text-muted-foreground tabular-nums">
      <div className="flex items-baseline justify-between gap-4">
        <span>Last {HISTORY_DAYS} days</span>
        {total > 0 ? (
          <span>
            <span className="font-medium text-foreground">{Math.round((passed / total) * 100)}%</span> of {plural(total, "run")} passed
          </span>
        ) : (
          <span>No runs yet</span>
        )}
      </div>
      <div role="img" aria-label={`${passed} of ${total} runs passed in the last ${HISTORY_DAYS} days`} className="flex h-16 items-end gap-1">
        {days.map((d) => {
          const runsThatDay = d.passed + d.failed;
          return (
            <Tooltip key={d.date.getTime()}>
              <TooltipTrigger asChild>
                <span className="flex h-full min-w-0 flex-1 flex-col justify-end transition-opacity hover:opacity-70">
                  {runsThatDay === 0 ? (
                    <span className="h-1 rounded-full bg-muted" />
                  ) : (
                    <span className="flex flex-col gap-px overflow-hidden rounded-[3px]" style={{ height: `${Math.max(20, (runsThatDay / busiest) * 100)}%` }}>
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
      {total > 0 && (
        <div className="flex items-baseline justify-between gap-4">
          {signatures > 0 && <span>{plural(signatures, "signature")} reviewed</span>}
          {typical !== undefined && <span className="ml-auto">{duration(typical)} typical run</span>}
        </div>
      )}
    </section>
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
