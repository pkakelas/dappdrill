import type { RunSummary } from "@dappdrill/db";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DAY, plural, shortDate } from "@/lib/format";

/** How far back the chart looks. */
export const HISTORY_DAYS = 14;

/** A slot per day, oldest first. */
function byDay(runs: RunSummary[], now = Date.now()) {
  const today = Math.floor(now / DAY);
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => ({ date: new Date((today - HISTORY_DAYS + 1 + i) * DAY), passed: 0, failed: 0 }));
  for (const r of runs) {
    const day = days[Math.floor(r.createdAt.getTime() / DAY) - today + HISTORY_DAYS - 1];
    if (day && r.status === "passed") day.passed++;
    if (day && r.status === "failed") day.failed++;
  }
  return days;
}

/** Is the app getting better: a small bar per day, failures on top, beside the heading of the Runs page. */
export function RunHistory({ runs }: { runs: RunSummary[] }) {
  const days = byDay(runs);
  const passed = days.reduce((n, d) => n + d.passed, 0);
  const total = passed + days.reduce((n, d) => n + d.failed, 0);
  const busiest = Math.max(1, ...days.map((d) => d.passed + d.failed));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium whitespace-nowrap text-muted-foreground tabular-nums">
        Last {HISTORY_DAYS} days{total > 0 && ` · ${Math.round((passed / total) * 100)}% of ${plural(total, "run")} passed`}
      </span>
      <div role="img" aria-label={`${passed} of ${total} runs passed in the last ${HISTORY_DAYS} days`} className="flex h-8 w-44 items-end gap-[3px]">
        {days.map((d) => {
          const runsThatDay = d.passed + d.failed;
          return (
            <Tooltip key={d.date.getTime()}>
              <TooltipTrigger asChild>
                <span className="flex h-full min-w-0 flex-1 flex-col justify-end transition-opacity hover:opacity-70">
                  {runsThatDay === 0 ? (
                    <span className="h-[3px] rounded-full bg-foreground/10" />
                  ) : (
                    <span className="flex flex-col gap-px overflow-hidden rounded-[2px]" style={{ height: `${Math.max(25, (runsThatDay / busiest) * 100)}%` }}>
                      {d.failed > 0 && <span className="min-h-0.5 bg-bad-mid" style={{ flexGrow: d.failed }} />}
                      {d.passed > 0 && <span className="min-h-0.5 bg-good-bar" style={{ flexGrow: d.passed }} />}
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
    </div>
  );
}
