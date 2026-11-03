import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronIcon, cx } from "./icons";
import { LiveDot } from "./status";

/* Page structure. One content width (.page), one header shape, one section
 * shape. Prefer these over hand-built flex stacks so pages keep one rhythm:
 * 36px between sections, 12px inside them. */

export type Crumb = { label: ReactNode; href?: string };

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="crumbs">
      {items.map((c, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">/</span>}
          {c.href ? <Link href={c.href}>{c.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

/** Crumbs, title, one line under it, actions on the right. `status` sits between title and sub. */
export function PageHeader({
  crumbs,
  title,
  sub,
  status,
  actions,
  children,
}: {
  crumbs?: Crumb[];
  title: ReactNode;
  sub?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      {crumbs && crumbs.length > 0 && <Crumbs items={crumbs} />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-2.5">
          <h1 className="h1">{title}</h1>
          {status}
          {sub && <div className="m-0 text-body text-ink-3">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

const slug = (s: ReactNode) => (typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") : undefined);

/** h2 + optional hint, with an action (usually a .btn-link) on the right. */
export function Section({ id, title, hint, action, children, className }: { id?: string; title: ReactNode; hint?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  const hid = id ?? slug(title);
  return (
    <section aria-labelledby={hid} className={cx("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={hid} className="h2 scroll-mt-28">
            {title}
          </h2>
          {hint && <p className="hint m-0">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Two-column settings section: title and hint on the left, controls on the right. */
export function SettingsSection({ id, title, hint, children }: { id: string; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} id={`${id}-section`} className="flex scroll-mt-28 flex-wrap gap-6 border-t border-line py-8">
      <div className="flex flex-[1_1_220px] flex-col gap-1.5">
        <h2 id={id} className="h3">
          {title}
        </h2>
        {hint && <p className="meta m-0 leading-normal">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-[2_1_440px] flex-col gap-3">{children}</div>
    </section>
  );
}

export function List({ children, className, ordered }: { children: ReactNode; className?: string; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return <Tag className={cx("list", className)}>{children}</Tag>;
}

/** A row in a List: title and meta on the left, an aside on the right. With href the whole row is a link. */
export function ListRow({
  href,
  title,
  meta,
  aside,
  className,
  current,
  scroll,
}: {
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  aside?: ReactNode;
  className?: string;
  current?: boolean;
  scroll?: boolean;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
        <span className="min-w-0 text-body font-medium">{title}</span>
        {meta && <span className="meta min-w-0">{meta}</span>}
      </span>
      {aside && <span className="flex shrink-0 items-center gap-2">{aside}</span>}
    </>
  );
  return (
    <li className={className}>
      {href ? (
        <Link href={href} scroll={scroll} aria-current={current ? "true" : undefined} className={cx("row row-link", current && "bg-sub")}>
          {body}
        </Link>
      ) : (
        <div className="row">{body}</div>
      )}
    </li>
  );
}

/** Nothing here yet: say why, and what to do. */
export function Empty({ title, children, action, className }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("card flex flex-col items-center gap-2 px-6 py-9 text-center", className)}>
      <p className="h3">{title}</p>
      {children && <div className="max-w-[52ch] text-sm text-muted">{children}</div>}
      {action && <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** A one-line "nothing to show" inside a section, lighter than Empty. */
export function Blank({ children }: { children: ReactNode }) {
  return <p className="m-0 rounded-xl border border-dashed border-line px-5 py-4 text-sm text-muted">{children}</p>;
}

export type NoticeTone = "neutral" | "bad" | "warn" | "live";

/** Callout. Tinted only for problems (bad, warn) and work in progress (live). */
export function Notice({ tone = "neutral", title, children, action, role, className }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode; action?: ReactNode; role?: "alert" | "status" | "note"; className?: string }) {
  return (
    <div role={role} className={cx("notice", tone !== "neutral" && `notice-${tone}`, className)}>
      {tone === "live" && <LiveDot className="mt-1.5" />}
      <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
        {title && <p className="m-0 font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** A collapsible card: logs, calldata, passed checks, setup snippets. */
export function Disclosure({ summary, aside, children, open, className, id }: { summary: ReactNode; aside?: ReactNode; children: ReactNode; open?: boolean; className?: string; id?: string }) {
  return (
    <details id={id} className={cx("group/dis card overflow-hidden", className)} open={open}>
      <summary className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-sub">
        <span className="flex items-center gap-2 text-sm font-medium">
          <ChevronIcon className="-rotate-90 text-muted transition-transform group-open/dis:rotate-0" />
          {summary}
        </span>
        {aside && <span className="meta">{aside}</span>}
      </summary>
      <div className="border-t border-divide">{children}</div>
    </details>
  );
}

/** "Show 3 low-severity issues": an inline text toggle that reveals more of the same list. */
export function Reveal({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <details className="group/rev">
      <summary className="btn-link w-fit text-muted hover:text-ink">
        <ChevronIcon className="-rotate-90 transition-transform group-open/rev:rotate-0" />
        {label}
      </summary>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </details>
  );
}

export function StatGrid({ stats, size = "md" }: { stats: { value: ReactNode; label: string; tone?: "bad" | "warn" }[]; size?: "md" | "sm" }) {
  return (
    <div className={cx("card grid gap-px overflow-hidden bg-divide", stats.length === 3 ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-4")}>
      {stats.map((s) => (
        <div key={s.label} className={cx("bg-card", size === "md" ? "px-5 py-5" : "px-4 py-3.5")}>
          <div className={cx("font-serif leading-none font-[360] tracking-[-0.02em] tabular-nums", size === "md" ? "text-[34px]" : "text-[26px]", s.tone === "bad" && "text-bad", s.tone === "warn" && "text-warn")}>
            {s.value}
          </div>
          <div className="mt-2 font-mono text-2xs tracking-[0.1em] text-muted uppercase">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Usage against a limit. Goes red only when the limit is reached. */
export function Meter({ label, value, fill }: { label: string; value: ReactNode; fill?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      <span className="font-serif text-[22px] leading-none font-[380] tabular-nums">{value}</span>
      {fill !== undefined && (
        <span className="mt-1 h-1.5 overflow-hidden rounded-full bg-hair" role="img" aria-label={`${Math.round(fill * 100)}% used`}>
          <span className={cx("block h-full rounded-full", fill >= 1 ? "bg-bad" : "bg-ink")} style={{ width: `${Math.min(100, Math.round(fill * 100))}%` }} />
        </span>
      )}
    </div>
  );
}

/** Label / value pairs: Expected / Actual, decoded arguments. */
export function Facts({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
