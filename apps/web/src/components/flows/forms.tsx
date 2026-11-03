"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { describeAction, setScheduleAction, type ActionResult } from "@/actions/flows";
import { cx } from "@/components/ui";

function Submit({ children, className, pendingText }: { children: React.ReactNode; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cx("btn", className)} disabled={pending}>
      {pending ? (pendingText ?? "Saving…") : children}
    </button>
  );
}

export function Feedback({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={cx("m-0 text-[13px]", state.error ? "text-bad" : "text-muted")}>
      {state.error ?? state.ok}
    </p>
  );
}

/** "Add a flow" / "Describe a change…" box. */
export function DescribeForm({ appId, flowId, label, placeholder, hint, button }: { appId: string; flowId?: string; label: string; placeholder: string; hint: string; button: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(describeAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="appId" value={appId} />
      {flowId && <input type="hidden" name="flowId" value={flowId} />}
      <label htmlFor={`describe-${flowId ?? "new"}`} className="label">
        {label}
      </label>
      <div className="flex flex-wrap gap-2.5">
        <input id={`describe-${flowId ?? "new"}`} name="prompt" required minLength={5} maxLength={2000} placeholder={placeholder} className="field min-w-0 flex-[1_1_360px]" autoComplete="off" />
        <Submit className="btn-primary" pendingText="Sending…">
          {button}
        </Submit>
      </div>
      <span className="hint">{hint}</span>
      <Feedback state={state} />
    </form>
  );
}

export function ScheduleForm({ appId, time, verified, host }: { appId: string; time: string | null; verified: boolean; host: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(setScheduleAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="appId" value={appId} />
      <label htmlFor="sched" className="label">
        Run every flow daily at (UTC)
      </label>
      <div className="flex gap-2">
        <input id="sched" name="time" type="time" defaultValue={time ?? "07:00"} className="field w-32 font-mono" />
        <Submit className="btn-sm btn-primary h-11">Save</Submit>
        {time && (
          <button type="submit" name="off" value="1" className="btn btn-sm h-11">
            Turn off
          </button>
        )}
      </div>
      {!verified && <p className="hint m-0">Needs {host} verified under Account → Domains.</p>}
      <Feedback state={state} />
    </form>
  );
}
