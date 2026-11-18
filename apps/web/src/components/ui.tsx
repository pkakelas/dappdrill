import { shortAddress } from "@dappdrill/core";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export { cn as cx };

/** The site's mark: a circle, half filled in the brand red. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill="var(--color-red)" />
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

const TONE = {
  warn: "bg-warn-bg text-warn",
  quiet: "bg-secondary text-muted-foreground",
};

export function Tag({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <Badge variant="secondary" className={cn("rounded-md", TONE[tone])}>
      {children}
    </Badge>
  );
}

export function PageHeader({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-1">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {description && <div className="text-muted-foreground">{description}</div>}
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

export function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y rounded-xl border bg-card shadow-xs">{children}</ul>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted-foreground">{children}</div>}
    </div>
  );
}
