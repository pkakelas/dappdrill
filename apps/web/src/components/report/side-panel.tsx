import Link from "next/link";
import type { ReactNode } from "react";
import { PanelKeys } from "./panel-keys";

/** Detail drawer opened by ?panel=…; server-rendered, closed by link or Escape. */
export function SidePanel({ title, eyebrow, closeHref, children }: { title: ReactNode; eyebrow?: ReactNode; closeHref: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <Link href={closeHref} scroll={false} aria-label="Close panel" className="absolute inset-0 bg-ink/25" />
      <PanelKeys closeHref={closeHref} />
      <div className="relative flex h-full w-full max-w-[680px] flex-col overflow-y-auto border-l border-line bg-paper shadow-[0_0_40px_rgba(23,24,28,0.12)]">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-paper px-5 py-4 sm:px-7">
          <div className="flex min-w-0 flex-col gap-1.5">
            {eyebrow && <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">{eyebrow}</div>}
            <h2 id="panel-title" className="m-0 font-serif text-[24px] leading-snug font-[400] tracking-[-0.015em]">
              {title}
            </h2>
          </div>
          <Link href={closeHref} scroll={false} className="btn btn-icon shrink-0" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 3l8 8M11 3l-8 8" />
            </svg>
          </Link>
        </div>
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-7">{children}</div>
      </div>
    </div>
  );
}

export function PanelSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="eyebrow">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
