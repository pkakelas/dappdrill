import type { TestStepResult } from "@dappdrill/core";
import { Wallet } from "lucide-react";
import { cx } from "@/components/ui";
import { StateMark } from "./status";

export type StepWithResult = { text: string; result?: TestStepResult; shot?: string | null; signs?: boolean; after?: React.ReactNode };

/** Numbered steps, each with how it went on a run (when there is one). */
export function StepList({ steps, className }: { steps: StepWithResult[]; className?: string }) {
  return (
    <ol className={cx("divide-y", className)}>
      {steps.map(({ text, result: r, shot, signs, after }, i) => (
        <li key={i} className={cx("flex flex-wrap gap-x-3 gap-y-2 px-4 py-3", r?.status === "fail" && "bg-bad-soft")}>
          <span className="flex w-5 shrink-0 justify-center">
            {r && r.status !== "pending" ? <StateMark state={r.status} /> : <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className={cx("leading-snug", r?.status === "skipped" && "text-muted-foreground")}>{text}</span>
            {r?.note && <span className={cx("leading-snug", r.status === "fail" ? "text-bad" : "text-muted-foreground")}>{r.note}</span>}
            {r && r.did.length > 0 && <span className="text-xs leading-snug text-muted-foreground">{r.did.join(" · ")}</span>}
            {signs && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Wallet className="size-3.5" aria-hidden="true" />
                Wallet signature
              </span>
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
