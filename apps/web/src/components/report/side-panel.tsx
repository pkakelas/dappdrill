import type { ReactNode } from "react";
import { PanelSheet } from "./panel-keys";

/** Detail drawer opened by ?panel=…; server-rendered content in a shadcn Sheet. */
export function SidePanel({ title, eyebrow, closeHref, children }: { title: ReactNode; eyebrow?: ReactNode; closeHref: string; children: ReactNode }) {
  return (
    <PanelSheet title={title} eyebrow={eyebrow} closeHref={closeHref}>
      {children}
    </PanelSheet>
  );
}

export function PanelSection({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
