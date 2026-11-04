"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { cx } from "@/components/ui";
import { CopyButton } from "@/components/copy-button";

type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/** A form bound to a server action, with its error / success line (and a one-time secret, if any). */
export function ActionForm({ action, children, className, secretLabel }: { action: Action; children: ReactNode; className?: string; secretLabel?: string }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(action, undefined);
  return (
    <form action={act} className={cx("flex flex-col gap-3", className)} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">
        {children}
      </fieldset>
      {state?.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      {state?.ok && !state.error && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.ok}
        </p>
      )}
      {state?.secret && (
        <div className="flex flex-col gap-2 rounded-lg border bg-muted/50 p-3">
          {secretLabel && <span className="text-sm">{secretLabel}</span>}
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-xs break-all">{state.secret}</code>
            <CopyButton text={state.secret} label="Copy" />
          </div>
        </div>
      )}
    </form>
  );
}
