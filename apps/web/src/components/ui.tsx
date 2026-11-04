import { VERDICT_LABEL, shortAddress, type Severity, type Verdict } from "@dappdrill/core";
import Link from "next/link";
import { Children, Fragment, type ComponentProps, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Item, ItemGroup, ItemSeparator } from "@/components/ui/item";
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

/** Only problems get colour: bad for Critical / Dangerous, warn for Medium / Check this. */
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
export const VERDICT_TEXT: Record<Verdict, string> = { dangerous: "text-bad", check: "text-warn", consistent: "text-muted-foreground" };

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

/** A page section: title, count and hint on the left on wide screens, content on the right. */
export function Section({ title, count, hint, aside, children }: { title: string; count?: number; hint?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="grid gap-4 py-10 first:pt-2 last:pb-0 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 lg:flex-col lg:flex-nowrap lg:justify-start lg:gap-1.5">
        <h2 className="flex items-baseline gap-2 text-base font-semibold tracking-tight">
          {title}
          {count !== undefined && <span className="text-sm font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {hint && <p className="order-last basis-full text-sm text-pretty text-muted-foreground lg:order-none lg:basis-auto">{hint}</p>}
        {aside && <div className="lg:mt-2">{aside}</div>}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
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

export function ItemList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ItemGroup className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)}>
      {Children.toArray(children).map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <ItemSeparator />}
          {child}
        </Fragment>
      ))}
    </ItemGroup>
  );
}

/** One row of an ItemList. Put a RowLink in it to make the whole row clickable; ItemActions stay clickable above it. */
export function ListItem({ className, ...props }: ComponentProps<typeof Item>) {
  return (
    <Item
      size="sm"
      role="listitem"
      className={cn("relative min-h-14 rounded-none hover:bg-accent/40 [&_[data-slot=item-actions]]:relative [&_[data-slot=item-actions]]:z-10", className)}
      {...props}
    />
  );
}

/** The row's main link, stretched over the whole ListItem. */
export function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link href={href} scroll={false} className={cn("outline-none after:absolute after:inset-0 focus-visible:underline", className)}>
      {children}
    </Link>
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
