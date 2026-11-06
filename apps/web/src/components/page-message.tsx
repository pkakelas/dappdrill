import type { ReactNode } from "react";

/** A whole page that only has something to say: not found, or something broke. */
export function PageMessage({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page flex flex-col items-center gap-2 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-pretty text-muted-foreground">{children}</p>
      {actions && <div className="flex flex-wrap justify-center gap-2 pt-4">{actions}</div>}
    </div>
  );
}
