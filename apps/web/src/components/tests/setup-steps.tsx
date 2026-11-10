import type { TestCheckResult, TestStepResult } from "@dappdrill/core";
import { ListChecks, Wallet } from "lucide-react";
import { cx } from "@/components/ui";
import { StateMark } from "./status";

/** A check kept on the step, with how it went on the run shown (when it ran) and a way to take it off. */
export type StepCheck = { name: string; result?: TestCheckResult; remove?: React.ReactNode };

export type StepWithResult = { text: string; result?: TestStepResult; shot?: string | null; signs?: boolean; checks?: StepCheck[]; after?: React.ReactNode };

/** How a failed step reads: the app's fault unless a second look put it on the test (input) or on nobody (skipped). */
const FAILED = {
  fail: { row: "bg-bad-soft", note: "text-bad" },
  input: { row: "bg-warn-soft", note: "text-warn-ink" },
  skipped: { row: "bg-muted/50", note: "text-muted-foreground" },
};

/** Numbered steps, each with how it went on a run (when there is one). */
export function StepList({ steps, className, failed = "fail" }: { steps: StepWithResult[]; className?: string; failed?: keyof typeof FAILED }) {
  return (
    <ol className={cx("divide-y", className)}>
      {steps.map(({ text, result: r, shot, signs, checks, after }, i) => (
        <li key={i} className={cx("flex flex-wrap gap-x-3 gap-y-2 px-4 py-3", r?.status === "fail" && FAILED[failed].row)}>
          <span className="flex w-5 shrink-0 justify-center">
            {r && r.status !== "pending" ? <StateMark state={r.status === "fail" ? failed : r.status} /> : <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cx("leading-snug", r?.status === "skipped" && "text-muted-foreground")}>{text}</span>
            {r?.note && <span className={cx("leading-snug", r.status === "fail" ? FAILED[failed].note : "text-muted-foreground")}>{r.note}</span>}
            {r && r.did.length > 0 && <span className="text-xs leading-snug text-muted-foreground">{r.did.join(" · ")}</span>}
            {signs && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wallet className="size-3.5" aria-hidden="true" />
                Wallet signature
              </span>
            )}
            {checks && checks.length > 0 && (
              <ul className="flex flex-col gap-1.5 pt-1">
                {checks.map((c, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    {c.result ? <StateMark state={c.result.status} className="mt-0.5" /> : <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cx("leading-snug", c.result?.status === "fail" ? "text-bad" : c.result?.status === "error" && "text-warn")}>{c.name}</span>
                      <span className="text-xs leading-snug text-muted-foreground">{c.result ? c.result.evidence : "Checked on every run."}</span>
                    </span>
                    {c.remove}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {shot && (
            <a href={shot} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Screenshot after step ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot} alt="" className="h-12 w-20 rounded-md border object-cover object-top" />
            </a>
          )}
          {after && <div className="basis-full pl-2.5">{after}</div>}
        </li>
      ))}
    </ol>
  );
}
