import Link from "next/link";
import type { ReactNode } from "react";
import { CloseIcon } from "@/components/ui";
import { PanelKeys } from "./panel-keys";

/**
 * Detail drawer opened by ?panel=…; server-rendered, closed by link or Escape.
 * Actions go in `footer`, which stays in view while the evidence scrolls.
 */
export function SidePanel({ title, eyebrow, closeHref, children, footer }: { title: ReactNode; eyebrow?: ReactNode; closeHref: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="panel-title">
      <Link href={closeHref} scroll={false} aria-label="Close panel" tabIndex={-1} className="absolute inset-0 bg-ink/25" />
      <PanelKeys closeHref={closeHref} />
      <div id="side-panel" tabIndex={-1} className="relative flex h-full w-full max-w-[680px] flex-col border-l border-line bg-paper shadow-panel outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-7">
          <div className="flex min-w-0 flex-col gap-1.5">
            {eyebrow && <div className="meta flex flex-wrap items-center gap-2">{eyebrow}</div>}
            <h2 id="panel-title" className="title">
              {title}
            </h2>
          </div>
          <Link href={closeHref} scroll={false} className="btn btn-icon shrink-0" aria-label="Close">
            <CloseIcon />
          </Link>
        </div>
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-6 sm:px-7">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line bg-paper px-5 py-3.5 sm:px-7">{footer}</div>}
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
