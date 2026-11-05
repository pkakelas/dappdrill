"use client";

import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";
import { useState } from "react";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { StepWithResult } from "./setup-steps";
import { StateMark } from "./status";

/** Fewer steps than this keep their size instead of stretching across the page. */
const MIN_COLUMNS = 4;

function Mark({ step, n }: { step: StepWithResult; n: number }) {
  const status = step.result?.status;
  if (status && status !== "pending") return <StateMark state={status} />;
  return <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground tabular-nums">{n}</span>;
}

/** The setup as a strip of frames, one per step, left to right along a line. A frame opens what that step did. */
export function SetupStrip({ steps }: { steps: StepWithResult[] }) {
  const [open, setOpen] = useState<number>();
  const ran = steps.some((s) => s.shot);
  const failed = steps.findIndex((s) => s.result?.status === "fail");
  const step = open === undefined ? undefined : steps[open];
  const did = step?.result?.did.filter((d) => d !== step.text).join(" · ");
  const rail = (i: number) => (failed < 0 || i < failed ? (ran ? "bg-emerald-500/30" : "bg-foreground/15") : "bg-foreground/5");
  const go = (by: number) => setOpen((i) => (i === undefined ? i : Math.min(steps.length - 1, Math.max(0, i + by))));

  return (
    <>
      <ol className="grid snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [scrollbar-width:none]" style={{ gridTemplateColumns: `repeat(${Math.max(steps.length, MIN_COLUMNS)}, minmax(9.5rem, 1fr))` }}>
        {steps.map((s, i) => {
          const bad = s.result?.status === "fail";
          return (
            <li key={i} className="flex min-w-0 snap-start flex-col gap-2.5">
              {/* The mark sits over the middle of its frame. The line runs the width of the strip, meeting the next frame's halfway across the gap. */}
              <div className="relative flex h-5 items-center justify-center">
                <span className={cx("absolute right-[calc(50%+0.875rem)] h-px", i === 0 ? "left-0" : "-left-1.5", rail(i - 1))} />
                <Mark step={s} n={i + 1} />
                <span className={cx("absolute left-[calc(50%+0.875rem)] h-px", i === steps.length - 1 ? "right-0" : "-right-1.5", rail(i))} />
              </div>
              {ran ? (
                <button type="button" onClick={() => setOpen(i)} aria-label={`Step ${i + 1}: ${s.text}`} className="group/frame flex flex-col gap-2 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className={cx("block aspect-[16/10] overflow-hidden rounded-lg border bg-muted/50 transition-[border-color,box-shadow] group-hover/frame:shadow-sm", bad ? "border-bad-mid" : "group-hover/frame:border-foreground/25")}>
                    {s.shot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.shot} alt="" loading="lazy" className="size-full object-cover object-top transition-transform duration-300 group-hover/frame:scale-[1.03]" />
                    ) : (
                      <span className="flex size-full items-center justify-center text-muted-foreground/40">
                        <ImageOff className="size-4" aria-hidden="true" />
                      </span>
                    )}
                  </span>
                  <span className={cx("line-clamp-2 text-center text-sm leading-snug text-balance", bad ? "font-medium text-bad" : "text-foreground/80")}>{s.text}</span>
                </button>
              ) : (
                <span className="line-clamp-2 text-center text-sm leading-snug text-balance text-foreground/80">{s.text}</span>
              )}
            </li>
          );
        })}
      </ol>

      {failed >= 0 && steps[failed]!.result?.note && (
        <p className="text-sm text-pretty text-bad">
          Stopped at step {failed + 1}: {steps[failed]!.result!.note}
        </p>
      )}

      <Dialog open={step !== undefined} onOpenChange={(on) => !on && setOpen(undefined)}>
        {step && (
          <DialogContent
            className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
            showCloseButton={false}
            // On the dialog itself, so the arrow keys work without a ring on the first button.
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              (e.currentTarget as HTMLElement).focus();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") go(-1);
              if (e.key === "ArrowRight") go(1);
            }}
          >
            {step.shot && (
              <a href={step.shot} target="_blank" rel="noreferrer" className="block border-b bg-muted/50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={step.shot} alt={`The page after step ${open! + 1}`} className="max-h-[60vh] w-full object-contain" />
              </a>
            )}
            <div className="flex items-start gap-4 p-5">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="text-xs text-muted-foreground tabular-nums">
                  Step {open! + 1} of {steps.length}
                </p>
                <DialogTitle className="text-base font-medium text-pretty">{step.text}</DialogTitle>
                <DialogDescription className={cx("text-pretty", step.result?.status === "fail" && "text-bad")}>{step.result?.note ?? did}</DialogDescription>
                {step.result?.note && did && <p className="text-xs text-muted-foreground">{did}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="outline" size="icon-sm" aria-label="Previous step" disabled={open === 0} onClick={() => go(-1)}>
                  <ChevronLeft />
                </Button>
                <Button type="button" variant="outline" size="icon-sm" aria-label="Next step" disabled={open === steps.length - 1} onClick={() => go(1)}>
                  <ChevronRight />
                </Button>
                <DialogClose asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Close">
                    <X />
                  </Button>
                </DialogClose>
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
