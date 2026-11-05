"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { deleteFlowAction, renameFlowAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import { AddTest } from "./add-test";
import { RunButton } from "./run-button";
import { RAIL, REVEAL, STATE_LABEL, type TestState } from "./status";

const TICK: Partial<Record<TestState, string>> = { pass: "bg-foreground/25", fail: "bg-bad", error: "bg-warn-bar", running: "bg-live", queued: "bg-live" };

/** One tick per test, so a flow's health reads before its rows do. */
function Health({ states }: { states: TestState[] }) {
  return (
    <div role="img" aria-label={states.map((s) => STATE_LABEL[s]).join(", ")} className="flex h-1 gap-1">
      {states.map((s, i) => (
        <span key={i} className={cx("h-full max-w-5 flex-1 rounded-full", TICK[s] ?? "bg-muted")} />
      ))}
    </div>
  );
}

/** A flow: its name, health and actions in the rail, its tests beside them. */
export function FlowSection({ appId, flow, states, summary, activeIds, children }: { appId: string; flow: { id: string; name: string }; states: TestState[]; summary: string; activeIds: string[]; children: ReactNode }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(flow.name);
  const [pending, start] = useTransition();
  // Delete asks once, in place: the first pick arms it for a few seconds (as ConfirmButton does).
  const [armed, setArmed] = useState(false);
  const [deleting, startDelete] = useTransition();
  const toRename = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  const save = () =>
    start(async () => {
      if (name.trim() && name.trim() !== flow.name) await renameFlowAction(flow.id, name);
      setRenaming(false);
    });

  return (
    <section aria-label={flow.name} className={cx("group/flow", RAIL)}>
      <div className="relative flex min-w-0 flex-col gap-3 self-start md:sticky md:top-20 md:pt-2.5">
        <div className="min-w-0 max-md:pr-28">
          {renaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <label htmlFor={`rename-${flow.id}`} className="sr-only">
                Flow name
              </label>
              <Input
                id={`rename-${flow.id}`}
                ref={input}
                value={name}
                disabled={pending}
                onChange={(e) => setName(e.target.value)}
                onBlur={save}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setName(flow.name);
                    setRenaming(false);
                  }
                }}
                maxLength={60}
                className="h-8 font-semibold"
              />
            </form>
          ) : (
            <h2 className="font-semibold tracking-tight text-pretty">{flow.name}</h2>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">
            {plural(states.length, "test")} · {summary}
          </p>
        </div>
        <Health states={states} />
        <div className={cx("absolute flex items-center gap-0.5 max-md:top-0 max-md:right-0 md:top-full md:left-3 md:mt-0.5", activeIds.length === 0 && REVEAL, "group-hover/flow:opacity-100")}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Add a test to ${flow.name}`} title="Add a test" onClick={() => setAdding(true)} className="rounded-full text-muted-foreground hover:text-foreground">
            <Plus />
          </Button>
          <RunButton target={{ appId, flowId: flow.id }} active={activeIds.length > 0} stopIds={activeIds} label="Run flow" />
          <DropdownMenu onOpenChange={(open) => !open && setArmed(false)}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${flow.name}`} className="rounded-full text-muted-foreground hover:text-foreground">
                <Ellipsis />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56"
              onCloseAutoFocus={(e) => {
                // Renaming focuses the name field rather than handing focus back to this button. Done here, not with
                // autoFocus, because the menu still holds focus while it closes and the field's onBlur would save.
                if (!toRename.current) return;
                e.preventDefault();
                toRename.current = false;
                input.current?.focus();
              }}
            >
              <DropdownMenuItem
                onSelect={() => {
                  toRename.current = true;
                  setRenaming(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                disabled={deleting}
                onSelect={(e) => {
                  e.preventDefault();
                  if (armed) startDelete(async () => void (await deleteFlowAction(flow.id)));
                  else setArmed(true);
                }}
              >
                {deleting ? "Deleting…" : armed ? "Delete flow and its tests?" : "Delete flow"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="min-w-0">
        {adding && <AddTest appId={appId} flowId={flow.id} flowName={flow.name} onClose={() => setAdding(false)} />}
        {states.length > 0 ? children : !adding && <p className="py-2.5 text-sm text-muted-foreground">No tests yet.</p>}
      </div>
    </section>
  );
}
