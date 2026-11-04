import { VERDICT_LABEL, shortAddress, type Severity, type Verdict } from "@dappdrill/core";
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

/** Two-column settings section: title and hint on the left, fields on the right. */
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

export function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
      <path d="M4 2.5v9l7-4.5z" />
    </svg>
  );
}
