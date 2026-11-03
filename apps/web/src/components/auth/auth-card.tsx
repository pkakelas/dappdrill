import type { ReactNode } from "react";

/** The one card every auth page sits in: a title, a line under it, then the form. */
export function AuthCard({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card flex flex-col gap-6 p-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="h1-sm">{title}</h1>
        {sub && <p className="m-0 text-body text-muted">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
