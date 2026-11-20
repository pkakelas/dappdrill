import type { TestRunRow } from "@dappdrill/db";
import { Wrench } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";
import { timeAgo, TRIGGER_LABEL } from "@/lib/format";
import { STATE_LABEL, STATE_TEXT, StateMark, type TestState } from "./status";

/** How a test stands in a word, as its page and the app's list both say it. */
export interface StatusWord {
  label: string;
  mark: TestState | "repair";
  tone?: string;
}

/**
 * Where a test stands, in one block at the top of its page: the status in a line with its last results beside
 * it, and under it whatever explains the status (why it needs repair, the bug it found, why it couldn't be
 * verified), each a `StatusNote`.
 */
export function TestStatus({ word, meta, results, children }: { word: StatusWord; meta?: ReactNode; results?: ReactNode; children?: ReactNode }) {
  return (
    <section aria-label="Status" className="divide-y rounded-xl border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          {word.mark === "repair" ? (
            <span role="img" aria-label="Needs repair" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <Wrench className="size-4" aria-hidden="true" />
            </span>
          ) : (
            <StateMark state={word.mark} label={word.label} size="lg" />
          )}
          <p className="flex min-w-0 flex-col gap-x-1.5 sm:flex-row sm:flex-wrap sm:items-baseline">
            <span className={cx("font-medium", word.tone ?? (word.mark === "repair" ? "text-warn" : word.mark === "passed" ? "text-foreground" : STATE_TEXT[word.mark]))}>{word.label}</span>
            {meta && (
              <span className="text-muted-foreground">
                <span aria-hidden="true" className="hidden sm:inline">
                  ·{" "}
                </span>
                {meta}
              </span>
            )}
          </p>
        </div>
        {results}
      </div>
      {children}
    </section>
  );
}

/** One thing that explains the status: a few words of title, what there is to say, and what can be done about it on the right. */
export function StatusNote({ title, tone, action, children }: { title?: string; tone?: "bad" | "warn"; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:px-5">
      <div className="flex min-w-0 max-w-3xl flex-1 flex-col gap-1.5 text-sm text-pretty">
        {title && <h2 className={cx("font-medium", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-foreground")}>{title}</h2>}
        {children}
      </div>
      {action && <div className="flex shrink-0 items-center">{action}</div>}
    </div>
  );
}

const DOT: Record<TestRunRow["status"], string> = {
  passed: "bg-good-bar",
  failed: "bg-bad-mid",
  unverified: "bg-warn-bar",
  running: "bg-live animate-pulse motion-reduce:animate-none",
  queued: "border-2 border-live",
  stopped: "bg-foreground/15",
};

/** A test's results as a row of marks, oldest first. Each opens that result on the test's page. */
export function Results({ here, runs, selected }: { here: string; runs: TestRunRow[]; selected?: string }) {
  return (
    <nav aria-label="Results" className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground">Last {runs.length} results</span>
      <ol className="flex items-center gap-1">
        {[...runs].reverse().map((r) => (
          <li key={r.id} className="flex">
            <Link
              href={r.id === runs[0]!.id ? here : `${here}?run=${r.id}`}
              aria-current={r.id === selected ? "true" : undefined}
              aria-label={`${STATE_LABEL[r.status]}, ${timeAgo(r.createdAt)}`}
              title={`${STATE_LABEL[r.status]} · ${TRIGGER_LABEL[r.trigger]} · ${timeAgo(r.createdAt)}`}
              className={cx("flex size-4 items-center justify-center rounded-[5px] outline-none hover:bg-foreground/10 focus-visible:ring-2 focus-visible:ring-ring", r.id === selected && "ring-1 ring-foreground/40")}
            >
              <span className={cx("size-2.5 rounded-[3px]", DOT[r.status])} />
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  );
}
