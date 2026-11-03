"use client";

import { useActionState, type ReactNode } from "react";
import { describeAction, setScheduleAction, type ActionResult } from "@/actions/flows";
import { Field, FormMessage, Hidden, SubmitButton } from "@/components/ui";

/** "Add a flow" / "Describe a change…" box. */
export function DescribeForm({ appId, flowId, label, placeholder, hint, button }: { appId: string; flowId?: string; label: string; placeholder: string; hint: ReactNode; button: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(describeAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2.5">
      <Hidden fields={{ appId, flowId }} />
      <Field label={label} hint={hint}>
        <span className="flex flex-wrap gap-2.5">
          <input name="prompt" required minLength={5} maxLength={2000} placeholder={placeholder} className="field min-w-0 flex-[1_1_360px]" autoComplete="off" />
          <SubmitButton className="btn-primary" pendingText="Sending…">
            {button}
          </SubmitButton>
        </span>
      </Field>
      <FormMessage state={state} />
    </form>
  );
}

export function ScheduleForm({ appId, time, verified, host }: { appId: string; time: string | null; verified: boolean; host: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(setScheduleAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Hidden fields={{ appId }} />
      <Field label="Run every flow daily at (UTC)" hint={verified ? undefined : `Needs ${host} verified under Account → Domains.`}>
        <span className="flex gap-2">
          <input name="time" type="time" defaultValue={time ?? "07:00"} className="field w-32 font-mono" />
          <SubmitButton className="btn-primary" pendingText="Saving…">
            Save
          </SubmitButton>
          {time && (
            <SubmitButton name="off" value="1">
              Turn off
            </SubmitButton>
          )}
        </span>
      </Field>
      <FormMessage state={state} />
    </form>
  );
}
