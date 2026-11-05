import type { TestRunStatus } from "@dappdrill/core";
import type { RunSummary } from "@dappdrill/db";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { duration, plural, shortDate } from "@/lib/format";

/** How far back the chart looks. */
export const HISTORY_DAYS = 14;

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
    <section aria-label={`The last ${HISTORY_DAYS} days`} className="flex flex-col gap-4 rounded-xl border bg-card p-5 text-sm text-muted-foreground tabular-nums shadow-sm">
      <div className="flex items-baseline justify-between gap-4">
        <span className="font-medium text-foreground">Last {HISTORY_DAYS} days</span>
        {total > 0 ? (
          <span>
            <span className="font-medium text-foreground">{Math.round((passed / total) * 100)}%</span> of {plural(total, "run")} passed
          </span>
        ) : (
          <span>No runs yet</span>
        )}
      </div>
      <div role="img" aria-label={`${passed} of ${total} runs passed in the last ${HISTORY_DAYS} days`} className="flex h-20 items-end gap-1">
        {days.map((d) => {
          const runsThatDay = d.passed + d.failed;
          return (
            <Tooltip key={d.date.getTime()}>
              <TooltipTrigger asChild>
                <span className="flex h-full min-w-0 flex-1 flex-col justify-end transition-opacity hover:opacity-70">
                  {runsThatDay === 0 ? (
                    <span className="h-1 rounded-full bg-foreground/10" />
                  ) : (
                    <span className="flex flex-col gap-0.5 overflow-hidden rounded-t" style={{ height: `${Math.max(20, (runsThatDay / busiest) * 100)}%` }}>
                      {d.failed > 0 && <span className="min-h-1 bg-rose-500" style={{ flexGrow: d.failed }} />}
                      {d.passed > 0 && <span className="min-h-1 bg-good-bar" style={{ flexGrow: d.passed }} />}
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
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-xs bg-good-bar" />
            Passed
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-xs bg-rose-500" />
            Failed
          </span>
          <span className="flex gap-3 sm:ml-auto">
            {signatures > 0 && <span>{plural(signatures, "signature")} reviewed</span>}
            {typical !== undefined && <span>{duration(typical)} typical run</span>}
          </span>
        </div>
      )}
    </section>
  );
}
