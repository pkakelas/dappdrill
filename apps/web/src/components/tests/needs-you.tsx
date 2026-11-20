import type { ReactNode } from "react";

/**
 * Everything on an app that waits for its owner, in one list: a setup that didn't finish, tests that can't run,
 * a question about something we couldn't write a test for. Each is answered where it stands.
 */
export function NeedsYou({ count, note, children }: { count: number; note?: string; children: ReactNode }) {
  return (
    <section aria-labelledby="needs-you" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="needs-you" className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <span aria-hidden="true" className="size-2 rounded-full bg-warn-bar" />
          Needs you
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">{count}</span>
        {note && <span className="text-sm text-muted-foreground">· {note}</span>}
      </div>
      <ul className="divide-y rounded-xl border bg-card shadow-xs">{children}</ul>
    </section>
  );
}

/** One thing that needs the owner: what it is, why in a line or two, and what they can do about it on the right. */
export function Need({ title, actions, children, below }: { title: ReactNode; actions?: ReactNode; children?: ReactNode; below?: ReactNode }) {
  return (
    <li className="flex flex-col gap-4 px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="font-medium text-pretty">{title}</p>
          {children && <div className="flex max-w-3xl flex-col gap-1 text-sm text-pretty text-muted-foreground">{children}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {below}
    </li>
  );
}
