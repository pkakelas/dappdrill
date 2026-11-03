import type { Flow } from "@dappdrill/core";
import type { flowChanges, repairs } from "@dappdrill/db";
import { resolveChangeAction, resolveRepairAction } from "@/actions/flows";
import { ActionButton, Notice, Reveal } from "@/components/ui";
import { StepsPreview } from "./steps-preview";

type Change = typeof flowChanges.$inferSelect;
type Repair = typeof repairs.$inferSelect;

function Choice({ action, name, id, yes, no = "Discard" }: { action: (f: FormData) => Promise<void>; name: string; id: string; yes?: string; no?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {yes && (
        <ActionButton action={action} fields={{ [name]: id, accept: "1" }} className="btn-sm btn-primary" pendingText="Saving…">
          {yes}
        </ActionButton>
      )}
      <ActionButton action={action} fields={{ [name]: id }} className="btn-sm">
        {no}
      </ActionButton>
    </div>
  );
}

/** A plain-English change waiting for the worker, or for the person to accept it. */
export function ChangeCard({ change, current }: { change: Change; current?: Flow }) {
  const busy = change.status === "queued" || change.status === "running";
  const prompt = <p className="m-0 text-body">“{change.prompt}”</p>;

  if (busy)
    return (
      <Notice tone="live" role="status" title="Working on it">
        {prompt}
        <p className="m-0 mt-1 text-sm">Walking the app with the wallet. This takes a minute or two.</p>
      </Notice>
    );

  if (change.status === "done" && change.proposed)
    return (
      <section className="card flex flex-col gap-3 p-5" aria-label="Proposed change">
        <div className="flex flex-col gap-1">
          <span className="label">{current ? "Proposed change" : "Proposed flow"}</span>
          {prompt}
        </div>
        {change.explanation && <p className="m-0 text-sm text-ink-2">{change.explanation}</p>}
        <StepsPreview flow={change.proposed} before={current} />
        <Choice action={resolveChangeAction} name="changeId" id={change.id} yes={current ? "Accept change" : "Save this flow"} />
      </section>
    );

  return (
    <Notice tone="bad" title="Couldn't do this one" action={<Choice action={resolveChangeAction} name="changeId" id={change.id} no="Dismiss" />}>
      {prompt}
      <p className="m-0 mt-1 text-sm">{change.error ?? "No proposal came back."}</p>
    </Notice>
  );
}

export function RepairBanner({ repair, flowName, current }: { repair: Repair; flowName: string; current: Flow }) {
  return (
    <Notice tone="warn" title={`“${flowName}” needs a small fix`} action={<Choice action={resolveRepairAction} name="repairId" id={repair.id} yes="Accept fix" no="Dismiss" />}>
      <p className="m-0 text-ink-2">{repair.explanation}</p>
      <div className="mt-2">
        <Reveal label="Show the change">
          <StepsPreview flow={repair.proposed} before={current} />
        </Reveal>
      </div>
    </Notice>
  );
}
