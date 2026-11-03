import { HEALTH_LABEL, VERDICT_LABEL, shortAddress, type Health, type RunStatus, type Severity, type Verdict } from "@dappdrill/core";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export { cn as cx };

/** The site's mark: a circle, half filled in the brand red (`mono` draws it in one colour). */
export function Logo({ size = 20, mono }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill={mono ? "currentColor" : "var(--color-red)"} />
    </svg>
  );
}

/** Addresses and code are the only monospace text. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono", className)}>{children}</span>;
}

export function Addr({ value, chars = 4, className }: { value?: string | null; chars?: number; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("font-mono", className)} title={value}>
      {shortAddress(value, chars)}
    </span>
  );
}

/** Only problems get colour: bad for Broken / Critical / Dangerous, warn for Review / Medium / Check this. */
const TONE = {
  bad: "bg-bad-bg text-bad-ink",
  high: "bg-bad-soft text-bad",
  warn: "bg-warn-bg text-warn",
  quiet: "bg-secondary text-muted-foreground",
};

function Tag({ tone, children, className }: { tone: keyof typeof TONE; children: ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md", TONE[tone], className)}>
      {children}
    </Badge>
  );
}

const HEALTH_TONE: Record<Health, keyof typeof TONE> = { broken: "bad", review: "warn", ok: "quiet" };

export function HealthBadge({ health, className }: { health: Health; className?: string }) {
  return (
    <Tag tone={HEALTH_TONE[health]} className={className}>
      {HEALTH_LABEL[health]}
    </Tag>
  );
}

export const HEALTH_TEXT: Record<Health, string> = { broken: "text-bad", review: "text-warn", ok: "text-muted-foreground" };

const SEVERITY: Record<Severity, { label: string; tone: keyof typeof TONE }> = {
  critical: { label: "Critical", tone: "bad" },
  high: { label: "High", tone: "high" },
  medium: { label: "Medium", tone: "warn" },
  low: { label: "Low", tone: "quiet" },
};

export function SeverityTag({ severity }: { severity: Severity }) {
  const s = SEVERITY[severity];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}

const VERDICT_TONE: Record<Verdict, keyof typeof TONE> = { dangerous: "bad", check: "warn", consistent: "quiet" };
export const VERDICT_TEXT: Record<Verdict, string> = { dangerous: "text-bad", check: "text-warn", consistent: "text-muted-foreground" };

export function VerdictTag({ verdict, large }: { verdict: Verdict; large?: boolean }) {
  return (
    <Tag tone={VERDICT_TONE[verdict]} className={cn(large && "px-2.5 py-1 text-sm")}>
      {VERDICT_LABEL[verdict]}
    </Tag>
  );
}

/** One matrix cell / run outcome. */
export type CellKind = "pass" | "issue-high" | "issue" | "signing" | "fail" | "error" | "skipped" | "running" | "queued";

/** Squares: only problems get colour; the label (or the legend beside the matrix) carries the meaning. */
export const CELL: Record<CellKind, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-pass" },
  issue: { label: "Issue", cls: "bg-warn-bar" },
  "issue-high": { label: "High issue", cls: "bg-bad-mid" },
  signing: { label: "Signing", cls: "bg-bad" },
  fail: { label: "Fail", cls: "bg-bad-mid" },
  error: { label: "Error", cls: "bg-muted ring-[1.5px] ring-muted-foreground ring-inset" },
  skipped: { label: "Not run", cls: "ring-1 ring-border ring-inset" },
  running: { label: "Running", cls: "bg-live-bg ring-[1.5px] ring-live ring-inset" },
  queued: { label: "Queued", cls: "bg-muted ring-1 ring-border ring-inset" },
};

export function Cell({ kind, label, small }: { kind: CellKind; label?: boolean; small?: boolean }) {
  const c = CELL[kind];
  return (
    <span className={cn("inline-flex items-center gap-2 align-middle", small ? "text-xs text-muted-foreground" : "text-sm")} title={label ? undefined : c.label}>
      <i className={cn("shrink-0 rounded-[3px]", small ? "size-2.5" : "size-4", c.cls)} aria-hidden={label} />
      {label ? c.label : <span className="sr-only">{c.label}</span>}
    </span>
  );
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pass: "Passed",
  issue: "Issue",
  fail: "Failed",
  error: "Error",
  skipped: "Skipped",
};
export const RUN_STATUS_TEXT: Record<RunStatus, string> = {
  pass: "text-muted-foreground",
  issue: "text-warn",
  fail: "text-bad",
  error: "text-foreground",
  skipped: "text-muted-foreground",
};

/** Last-N run bars. Only problems get colour; passes are quiet grey. */
export function Sparkbars({ statuses, slots = 10 }: { statuses: RunStatus[]; slots?: number }) {
  const shown = statuses.slice(-slots);
  const pad = Math.max(0, slots - shown.length);
  const counts = shown.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  const label = shown.length
    ? `Last ${shown.length} runs: ` + Object.entries(counts).map(([s, n]) => `${n} ${RUN_STATUS_LABEL[s as RunStatus].toLowerCase()}`).join(", ")
    : "No runs yet";
  const color: Record<RunStatus, string> = { pass: "bg-border", issue: "bg-warn-bar", fail: "bg-bad", error: "bg-muted-foreground", skipped: "bg-muted" };
  return (
    <div role="img" aria-label={label} title={label} className="flex gap-[3px]">
      {Array.from({ length: pad }, (_, i) => (
        <span key={`p${i}`} className="h-4 w-1.5 rounded-[2px] bg-muted" />
      ))}
      {shown.map((s, i) => (
        <span key={i} className={cn("h-4 w-1.5 rounded-[2px]", color[s])} />
      ))}
    </div>
  );
}

export function StatGrid({ stats }: { stats: { value: ReactNode; label: string; tone?: "bad" | "warn" }[] }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-xl border bg-card px-5 py-4 shadow-xs">
          <div className="text-sm text-muted-foreground">{s.label}</div>
          <div className={cn("mt-1 text-2xl font-semibold tracking-tight", s.tone === "bad" && "text-bad", s.tone === "warn" && "text-warn")}>{s.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Page title row: heading, optional description and actions on the right. */
export function PageHeader({ title, description, actions, children }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="text-muted-foreground">{description}</div>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Two-column settings section. */
export function SettingsSection({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t py-6 md:grid-cols-[240px_1fr] md:gap-8">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="font-semibold">
          {title}
        </h2>
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

export function List({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn("divide-y rounded-xl border bg-card shadow-xs", className)}>{children}</ul>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted-foreground">{children}</div>}
    </div>
  );
}
