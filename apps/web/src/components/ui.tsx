import { HEALTH_LABEL, VERDICT_LABEL, shortAddress, type Health, type RunStatus, type Severity, type Verdict } from "@dappdrill/core";
import type { ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The site's mark: a circle, half filled. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </svg>
  );
}

/** Addresses and code are the only monospace text. */
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

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  return <span className={cx("tag", HEALTH_CLASS[health], className)}>{HEALTH_LABEL[health]}</span>;
}

export const HEALTH_TEXT: Record<Health, string> = { broken: "text-bad", review: "text-warn", ok: "text-muted" };

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
  return <span className={cx("tag", VERDICT_CLASS[verdict], large && "px-3 py-1.5 text-[11.5px]")}>{VERDICT_LABEL[verdict]}</span>;
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
  return <span className={cx("inline-block min-w-[60px] rounded-[5px] px-1.5 py-1 text-center font-mono text-[10.5px] font-medium tracking-[0.06em] uppercase", c.cls)}>{c.label}</span>;
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

/** Last-N run bars. Only problems get colour; passes are quiet grey. */
export function Sparkbars({ statuses, slots = 10 }: { statuses: RunStatus[]; slots?: number }) {
  const shown = statuses.slice(-slots);
  const pad = Math.max(0, slots - shown.length);
  const counts = shown.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  const label = shown.length
    ? `Last ${shown.length} runs: ` + Object.entries(counts).map(([s, n]) => `${n} ${RUN_STATUS_LABEL[s as RunStatus].toLowerCase()}`).join(", ")
    : "No runs yet";
  const color: Record<RunStatus, string> = { pass: "bg-quiet", issue: "bg-warn-bar", fail: "bg-bad", error: "bg-ink-3", skipped: "bg-divide" };
  return (
    <div role="img" aria-label={label} title={label} className="flex gap-[3px]">
      {Array.from({ length: pad }, (_, i) => (
        <span key={`p${i}`} className="h-[18px] w-2.5 rounded-[2px] bg-divide" />
      ))}
      {shown.map((s, i) => (
        <span key={i} className={cx("h-[18px] w-2.5 rounded-[2px]", color[s])} />
      ))}
    </div>
  );
}

export function StatGrid({ stats }: { stats: { value: ReactNode; label: string; tone?: "bad" | "warn" }[] }) {
  return (
    <div className="card grid grid-cols-2 gap-px overflow-hidden bg-divide sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="bg-card px-5 py-5">
          <div className={cx("font-serif text-[34px] leading-none font-[360] tracking-[-0.02em]", s.tone === "bad" && "text-bad", s.tone === "warn" && "text-warn")}>{s.value}</div>
          <div className="mt-2 font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Two-column settings section, as on the Account mockup. */
export function SettingsSection({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-wrap gap-6 border-t border-line py-7">
      <div className="flex flex-[1_1_220px] flex-col gap-1.5">
        <h2 id={id} className="m-0 font-serif text-[19px] font-[420] tracking-[-0.01em]">
          {title}
        </h2>
        {hint && <p className="m-0 text-[13px] leading-normal text-muted">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-[2_1_440px] flex-col gap-3">{children}</div>
    </section>
  );
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cx("card m-0 list-none divide-y divide-divide p-0", className)}>{children}</ul>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="card flex flex-col gap-2 px-6 py-8 text-center">
      <p className="m-0 font-serif text-[19px] font-[420]">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
      <path d="M4 2.5v9l7-4.5z" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className={className}>
      <path d="M3.5 5.5L7 9l3.5-3.5" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 7.5l2.5 2.5L11 4.5" />
    </svg>
  );
}
