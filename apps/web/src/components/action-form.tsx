"use client";

import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { cx } from "@/components/ui";
import { CopyButton } from "@/components/report/copy-button";

type Action = (prev: ActionResult, form: FormData) => Promise<ActionResult>;

/** A form bound to a server action, with its error / success line (and a one-time secret, if any). */
export function ActionForm({ action, children, className, secretLabel }: { action: Action; children: ReactNode; className?: string; secretLabel?: string }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(action, undefined);
  return (
    <form action={act} className={cx("flex flex-col gap-3", className)} aria-busy={pending}>
      <fieldset disabled={pending} className="m-0 contents border-0 p-0">
        {children}
      </fieldset>
      {state?.error && (
        <p role="alert" className="m-0 text-[13px] text-bad">
          {state.error}
        </p>
      )}
      {state?.ok && !state.error && (
        <p role="status" className="m-0 text-[13px] text-muted">
          {state.ok}
        </p>
      )}
      {state?.secret && (
        <div className="flex flex-col gap-2 rounded-[10px] border border-line bg-sub p-3">
          {secretLabel && <span className="text-[13px] text-ink-2">{secretLabel}</span>}
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 font-mono text-[13px] break-all">{state.secret}</code>
            <CopyButton text={state.secret} label="Copy" />
          </div>
        </div>
      )}
    </form>
  );
}
