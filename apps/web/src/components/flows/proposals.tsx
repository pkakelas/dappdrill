import type { Flow } from "@dappdrill/core";
import type { flowChanges, repairs } from "@dappdrill/db";
import { resolveChangeAction, resolveRepairAction } from "@/actions/flows";
import { Button } from "@/components/ui/button";
import { StepsPreview } from "./steps-preview";

type Change = typeof flowChanges.$inferSelect;
type Repair = typeof repairs.$inferSelect;

function Choice({ action, name, id, yes, no = "Discard" }: { action: (f: FormData) => Promise<void>; name: string; id: string; yes?: string; no?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {yes && (
        <form action={action}>
          <input type="hidden" name={name} value={id} />
          <input type="hidden" name="accept" value="1" />
          <Button type="submit" size="sm">
            {yes}
          </Button>
        </form>
      )}
      <form action={action}>
        <input type="hidden" name={name} value={id} />
        <Button type="submit" variant="outline" size="sm">
          {no}
        </Button>
      </form>
    </div>
  );
}

/** A plain-English change waiting for the worker, or for the person to accept it. */
export function ChangeCard({ change, current }: { change: Change; current?: Flow }) {
  const busy = change.status === "queued" || change.status === "running";
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-xs" aria-label="Proposed change">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{busy ? "Working on it" : change.status === "done" ? "Proposed change" : "Couldn't do this one"}</span>
        <p className="font-medium">“{change.prompt}”</p>
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-live" />
          Walking the app with the wallet. This takes a minute or two.
        </p>
      )}
      {change.status === "done" && change.proposed && (
        <>
          {change.explanation && <p className="text-muted-foreground">{change.explanation}</p>}
          <StepsPreview flow={change.proposed} before={current} />
          <Choice action={resolveChangeAction} name="changeId" id={change.id} yes={current ? "Accept change" : "Save this flow"} />
        </>
      )}
      {(change.status === "failed" || change.status === "stopped" || (change.status === "done" && !change.proposed)) && (
        <>
          <p className="text-bad">{change.error ?? "No proposal came back."}</p>
          <Choice action={resolveChangeAction} name="changeId" id={change.id} no="Dismiss" />
        </>
      )}
    </section>
  );
}

export function RepairBanner({ repair, flowName, current }: { repair: Repair; flowName: string; current: Flow }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warn-line bg-warn-soft p-5" aria-label={`Repair for ${flowName}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-1">
          <h2 className="font-semibold text-warn-ink">“{flowName}” needs a small fix</h2>
          <p className="text-warn-ink/80">{repair.explanation}</p>
        </div>
        <Choice action={resolveRepairAction} name="repairId" id={repair.id} yes="Accept fix" no="Dismiss" />
      </div>
      <details>
        <summary className="w-fit text-sm font-medium text-warn-ink underline-offset-4 hover:underline">Show the change</summary>
        <div className="mt-3 bg-card">
          <StepsPreview flow={repair.proposed} before={current} />
        </div>
      </details>
    </section>
  );
}
