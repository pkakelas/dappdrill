import { formatDuration, type StepStatus, type TestStepResult } from "@dappdrill/core";
import { Check, Wallet, X } from "lucide-react";
import { cx } from "@/components/ui";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { StateMark } from "./status";

export type StepWithResult = { text: string; result?: TestStepResult; shot?: string | null; signs?: boolean; after?: React.ReactNode };

/** Steps on a line, each with how it went on a run. One that ran opens to show what happened; a failed one starts open. */
export function StepList({ steps, className }: { steps: StepWithResult[]; className?: string }) {
  const failed = steps.flatMap((s, i) => (s.result?.status === "fail" ? [String(i)] : []));
  return (
    // Keyed so a step that fails live, or on the next result picked, opens too.
    <Accordion key={failed.join()} type="multiple" defaultValue={failed} asChild>
      <ol className={cx("py-1", className)}>
        {steps.map((step, i) => {
          const { result: r, shot, after } = step;
          const bad = r?.status === "fail";
          const li = "relative [--step-pad:0rem] before:absolute before:inset-y-0 before:left-[calc(var(--step-pad)+0.75rem)] before:w-px before:bg-border first:before:top-5 last:before:bottom-auto last:before:h-5";
          const row = <StepRow n={i + 1} step={step} />;
          const below = after && <div className="pr-(--step-pad) pb-2.5 pl-[calc(var(--step-pad)+2.25rem)]">{after}</div>;
          if (!r || (r.did.length === 0 && !r.note && !shot))
            return (
              <li key={i} className={li}>
                <div className="flex items-start gap-3 px-(--step-pad) py-2">
                  {row}
                  <span className="size-4 shrink-0" />
                </div>
                {below}
              </li>
            );
          return (
            <AccordionItem key={i} value={String(i)} asChild className="border-b-0">
              <li className={li}>
                <AccordionTrigger className={cx("items-start gap-3 px-(--step-pad) py-2 font-normal hover:no-underline", QUIET_CHEVRON)}>{row}</AccordionTrigger>
                <AccordionContent className="flex flex-wrap items-start gap-x-4 gap-y-2 pr-[calc(var(--step-pad)+1.75rem)] pt-1 pb-4 pl-[calc(var(--step-pad)+2.25rem)]">
                  {(r.note || r.did.length > 0) && (
                    <div className="flex min-w-48 flex-1 flex-col gap-1.5">
                      {r.note && <p className={cx("leading-snug", bad ? "text-bad" : "text-muted-foreground")}>{r.note}</p>}
                      {r.did.length > 0 && (
                        <ul className="flex flex-col gap-1 text-xs leading-snug text-muted-foreground">
                          {r.did.map((d, j) => (
                            <li key={j}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {shot && (
                    <a href={shot} target="_blank" rel="noreferrer" className="shrink-0" aria-label={`Screenshot after step ${i + 1}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shot} alt="" className="aspect-[16/10] w-56 rounded-lg object-cover object-top ring-1 ring-foreground/5 transition-opacity hover:opacity-90" />
                    </a>
                  )}
                </AccordionContent>
                {below}
              </li>
            </AccordionItem>
          );
        })}
      </ol>
    </Accordion>
  );
}

function StepRow({ n, step: { text, result: r, signs } }: { n: number; step: StepWithResult }) {
  return (
    <span className="flex min-w-0 flex-1 items-start gap-3">
      <StepMarker n={n} status={r?.status} />
      <span className={cx("min-w-0 flex-1 pt-0.5 leading-snug", r?.status === "skipped" && "text-muted-foreground", r?.status === "fail" && "font-medium text-bad")}>{text}</span>
      {signs && (
        <span className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <Wallet className="size-3.5" aria-hidden="true" /> Wallet signature
        </span>
      )}
      {r && r.durationMs > 0 && <span className="pt-1 text-xs text-muted-foreground tabular-nums">{formatDuration(r.durationMs)}</span>}
    </span>
  );
}

/** The chevron waits for the pointer, but stays on touch screens and once the step is open. */
const QUIET_CHEVRON = "[@media(hover:hover)]:[&>svg]:opacity-0 [@media(hover:hover)]:hover:[&>svg]:opacity-100 [@media(hover:hover)]:focus-visible:[&>svg]:opacity-100 [@media(hover:hover)]:data-[state=open]:[&>svg]:opacity-100";

/** The background breaks the line behind the marker. */
const MARKER = "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full bg-background";

function StepMarker({ n, status }: { n: number; status?: StepStatus }) {
  if (status === "pass")
    return (
      <span className={cx(MARKER, "text-muted-foreground")} role="img" aria-label={`Step ${n} passed`}>
        <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      </span>
    );
  if (status === "fail")
    return (
      <span className={cx(MARKER, "bg-bad text-white")} role="img" aria-label={`Step ${n} failed`}>
        <X className="size-3.5" strokeWidth={3} aria-hidden="true" />
      </span>
    );
  if (status === "running")
    return (
      <span className={MARKER}>
        <StateMark state="running" />
      </span>
    );
  return <span className={cx(MARKER, "text-xs tabular-nums", status === "skipped" ? "text-muted-foreground/70" : "text-muted-foreground")}>{n}</span>;
}
