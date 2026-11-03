"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { describeAction, setScheduleAction, type ActionResult } from "@/actions/flows";
import { cx } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit({ children, pendingText, ...props }: React.ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? (pendingText ?? "Saving…") : children}
    </Button>
  );
}

export function Feedback({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={cx("text-sm", state.error ? "text-destructive" : "text-muted-foreground")}>
      {state.error ?? state.ok}
    </p>
  );
}

/** "Add a flow" / "Describe a change…" box. */
export function DescribeForm({ appId, flowId, label, placeholder, hint, button }: { appId: string; flowId?: string; label: string; placeholder: string; hint: string; button: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(describeAction, undefined);
  const id = `describe-${flowId ?? "new"}`;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appId" value={appId} />
      {flowId && <input type="hidden" name="flowId" value={flowId} />}
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap gap-2">
        <Input id={id} name="prompt" required minLength={5} maxLength={2000} placeholder={placeholder} className="min-w-0 flex-[1_1_320px]" autoComplete="off" />
        <Submit pendingText="Sending…">{button}</Submit>
      </div>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <Feedback state={state} />
    </form>
  );
}

export function ScheduleForm({ appId, time, verified, host }: { appId: string; time: string | null; verified: boolean; host: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(setScheduleAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="appId" value={appId} />
      <Label htmlFor="sched">Run every flow daily at (UTC)</Label>
      <div className="flex gap-2">
        <Input id="sched" name="time" type="time" defaultValue={time ?? "07:00"} className="w-32 font-mono" />
        <Submit>Save</Submit>
        {time && (
          <Button type="submit" name="off" value="1" variant="outline">
            Turn off
          </Button>
        )}
      </div>
      {!verified && <p className="text-sm text-muted-foreground">Needs {host} verified under Account → Domains.</p>}
      <Feedback state={state} />
    </form>
  );
}
