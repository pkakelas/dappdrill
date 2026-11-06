import { VERDICT_LABEL, shortAddress, type Severity, type Verdict } from "@dappdrill/core";
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

export function Addr({ value, chars = 4, className }: { value?: string | null; chars?: number; className?: string }) {
  if (!value) return null;
  return (
    <span className={cn("font-mono", className)} title={value}>
      {shortAddress(value, chars)}
    </span>
  );
}

/** bad for Critical / Dangerous, warn for Medium / Check this. */
const TONE = {
  bad: "bg-bad-bg text-bad-ink",
  high: "bg-bad-soft text-bad",
  warn: "bg-warn-bg text-warn",
  quiet: "bg-secondary text-muted-foreground",
};

export function Tag({ tone, children, className }: { tone: keyof typeof TONE; children: ReactNode; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md", TONE[tone], className)}>
      {children}
    </Badge>
  );
}

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

export function VerdictTag({ verdict, large }: { verdict: Verdict; large?: boolean }) {
  return (
    <Tag tone={VERDICT_TONE[verdict]} className={cn(large && "px-2.5 py-1 text-sm")}>
      {VERDICT_LABEL[verdict]}
    </Tag>
  );
}

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

/** Two-column settings section: title and hint on the left, fields on the right. */
export function SettingsSection({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-6 border-t py-8 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-1.5">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
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
