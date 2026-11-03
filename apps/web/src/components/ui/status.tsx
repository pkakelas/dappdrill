import { HEALTH_LABEL, VERDICT_LABEL, shortAddress, type Health, type RunStatus, type Severity, type Verdict } from "@dappdrill/core";
import type { ReactNode } from "react";
import { cx } from "./icons";

/* Status vocabulary. Three result words (Broken / Review / OK) and their
 * relatives. Only problems get colour; OK and passes are quiet grey; blue only
 * ever means "still running". */

/** Addresses and code are the only monospace text in prose. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx("font-mono", className)}>{children}</span>;
}

export function Addr({ value, chars = 4, className }: { value?: string | null; chars?: number; className?: string }) {
  if (!value) return null;
  return (
    <span className={cx("font-mono", className)} title={value}>
      {shortAddress(value, chars)}
    </span>
  );
}

const HEALTH_CLASS: Record<Health, string> = {
  broken: "bg-bad text-paper",
  review: "bg-warn-bg text-warn",
  ok: "bg-hair text-muted",
};

export const HEALTH_TEXT: Record<Health, string> = { broken: "text-bad", review: "text-warn", ok: "text-muted" };

export function HealthBadge({ health, large, children, className }: { health: Health; large?: boolean; children?: ReactNode; className?: string }) {
  return <span className={cx("tag", HEALTH_CLASS[health], large && "tag-lg", className)}>{children ?? HEALTH_LABEL[health]}</span>;
}

const SEVERITY: Record<Severity, { label: string; cls: string }> = {
  critical: { label: "Critical", cls: "bg-bad text-paper" },
  high: { label: "High", cls: "bg-bad-bg text-bad" },
  medium: { label: "Medium", cls: "bg-warn-bg text-warn" },
  low: { label: "Low", cls: "bg-hair text-muted" },
};

export function SeverityTag({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return <span className={cx("tag", s.cls)}>{s.label}</span>;
}

const VERDICT_CLASS: Record<Verdict, string> = {
  dangerous: "bg-bad text-paper",
  check: "bg-warn-bg text-warn",
  consistent: "bg-hair text-ink-2",
};
export const VERDICT_TEXT: Record<Verdict, string> = { dangerous: "text-bad", check: "text-warn", consistent: "text-muted" };

export function VerdictTag({ verdict, large }: { verdict: Verdict; large?: boolean }) {
  return <span className={cx("tag", VERDICT_CLASS[verdict], large && "tag-lg")}>{VERDICT_LABEL[verdict]}</span>;
}

/** Quiet labels next to a title: Baseline, Unverified, Marked expected, Wallet. */
export function Pill({ children, tone = "quiet" }: { children: ReactNode; tone?: "quiet" | "live" | "warn" | "bad" }) {
  const cls = { quiet: "bg-hair text-muted", live: "bg-live-bg text-live-ink", warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad" }[tone];
  return <span className={cx("pill", cls)}>{children}</span>;
}

/** One matrix cell / run outcome. */
export type CellKind = "pass" | "issue-high" | "issue" | "signing" | "fail" | "error" | "skipped" | "running" | "queued";

const CELL: Record<CellKind, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-hair text-muted" },
  issue: { label: "Issue", cls: "bg-warn-bg text-warn" },
  "issue-high": { label: "Issue", cls: "bg-bad-bg text-bad" },
  signing: { label: "Signing", cls: "bg-bad text-paper" },
  fail: { label: "Fail", cls: "bg-bad-bg text-bad" },
  error: { label: "Error", cls: "bg-hair text-ink-2" },
  skipped: { label: "—", cls: "text-faint" },
  running: { label: "Running", cls: "bg-live-bg text-live-ink" },
  queued: { label: "Queued", cls: "text-muted" },
};

export function Cell({ kind }: { kind: CellKind }) {
  const c = CELL[kind];
  return <span className={cx("inline-block min-w-[60px] rounded-[5px] px-1.5 py-1 text-center font-mono text-2xs font-medium tracking-[0.06em] uppercase", c.cls)}>{c.label}</span>;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pass: "Passed",
  issue: "Issue",
  fail: "Failed",
  error: "Error",
  skipped: "Skipped",
};
export const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  pass: "text-muted",
  issue: "text-warn",
  fail: "text-bad",
  error: "text-ink-2",
  skipped: "text-faint",
};

/** A flow's latest result as words: "Passed", "Failed", "Needs a fix", "Not run yet". */
export function RunState({ status, needsFix, className }: { status?: RunStatus | null; needsFix?: boolean; className?: string }) {
  if (needsFix) return <span className={cx("text-warn", className)}>Needs a fix</span>;
  if (!status) return <span className={cx("text-muted", className)}>Not run yet</span>;
  return <span className={cx(RUN_STATUS_TEXT[status], className)}>{RUN_STATUS_LABEL[status]}</span>;
}

export type JobStatusValue = "queued" | "running" | "done" | "failed" | "stopped";

/** A scan or batch: live while it runs, then its health. `children` overrides the finished label. */
export function JobStatus({ status, health = "ok", children }: { status: JobStatusValue; health?: Health; children?: ReactNode }) {
  if (status === "done") return <HealthBadge health={health}>{children}</HealthBadge>;
  if (status === "queued" || status === "running")
    return (
      <Pill tone="live">
        {status === "running" && <span className="live-dot size-1.5" />}
        {status === "queued" ? "Queued" : "Running"}
      </Pill>
    );
  return <Pill>{status === "failed" ? "Failed" : "Stopped"}</Pill>;
}

export function LiveDot({ className }: { className?: string }) {
  return <span className={cx("live-dot", className)} aria-hidden="true" />;
}

const BAR: Record<RunStatus, string> = { pass: "bg-quiet", issue: "bg-warn-bar", fail: "bg-bad", error: "bg-ink-3", skipped: "bg-divide" };

/** Last-N run bars. Only problems get colour; passes are quiet grey. */
export function Sparkbars({ statuses, slots = 10 }: { statuses: RunStatus[]; slots?: number }) {
  const shown = statuses.slice(-slots);
  const pad = Math.max(0, slots - shown.length);
  const counts = shown.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  const label = shown.length
    ? `Last ${shown.length} runs: ` + Object.entries(counts).map(([s, n]) => `${n} ${RUN_STATUS_LABEL[s as RunStatus].toLowerCase()}`).join(", ")
    : "No runs yet";
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex gap-[3px] align-middle">
      {Array.from({ length: pad }, (_, i) => (
        <span key={`p${i}`} className="h-[18px] w-2.5 rounded-[2px] bg-divide" />
      ))}
      {shown.map((s, i) => (
        <span key={i} className={cx("h-[18px] w-2.5 rounded-[2px]", BAR[s])} />
      ))}
    </span>
  );
}

export function SparkLegend() {
  const item = (cls: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={cx("h-3 w-2 rounded-[2px]", cls)} />
      {label}
    </span>
  );
  return (
    <p className="meta m-0 flex flex-wrap gap-x-4 gap-y-1">
      {item(BAR.pass, "Passed")}
      {item(BAR.issue, "Issue or fix needed")}
      {item(BAR.fail, "Failed")}
      {item(BAR.skipped, "No run")}
    </p>
  );
}
