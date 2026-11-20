import { Check } from "lucide-react";
import { cx } from "@/components/ui";
import { LiveDot } from "./status";

export interface Stage {
  title: string;
  detail: string;
  state: "done" | "now" | "next";
}

const RULE = { done: "border-foreground/25", now: "border-foreground", next: "border-border" };

/** Where an app's first tests are: the three steps in a row, the one going on marked. */
export function Stages({ stages }: { stages: Stage[] }) {
  return (
    <ol className="grid gap-x-6 gap-y-5 sm:grid-cols-3">
      {stages.map((s, i) => (
        <li key={s.title} aria-current={s.state === "now" ? "step" : undefined} className={cx("flex flex-col gap-1 border-t-2 pt-3", RULE[s.state])}>
          <span className={cx("flex items-center gap-2 text-sm font-medium", s.state === "next" && "text-muted-foreground")}>
            <span className="flex size-4 shrink-0 items-center justify-center text-xs tabular-nums">{s.state === "done" ? <Check className="size-3.5" strokeWidth={2.5} aria-label="Done" /> : s.state === "now" ? <LiveDot /> : i + 1}</span>
            {s.title}
          </span>
          <span className="pl-6 text-sm text-pretty text-muted-foreground">{s.detail}</span>
        </li>
      ))}
    </ol>
  );
}
