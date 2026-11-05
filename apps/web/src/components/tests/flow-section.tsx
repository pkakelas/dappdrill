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

/** A flow: its name, goal, health and actions in the rail, its tests beside them. `states` is one per test, conditions not included. */
export function FlowSection({ appId, flow, states, summary, activeIds, children }: { appId: string; flow: { id: string; name: string; goal: string | null }; states: TestState[]; summary: ReactNode; activeIds: string[]; children: ReactNode }) {
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(flow.name);
  const [goal, setGoal] = useState(flow.goal ?? "");
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
      if (name.trim() && (name.trim() !== flow.name || goal.trim() !== (flow.goal ?? ""))) await renameFlowAction(flow.id, name, goal);
      setRenaming(false);
    });
  const cancel = () => {
    setName(flow.name);
    setGoal(flow.goal ?? "");
    setRenaming(false);
  };
  const tested = states.length > 0;

  return (
    <section aria-label={flow.name} className={cx("group/flow", RAIL)}>
      <div className="relative flex min-w-0 flex-col gap-3 self-start md:sticky md:top-20 md:pt-2.5">
        <div className="min-w-0 max-md:pr-28">
          {renaming ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
              onKeyDown={(e) => e.key === "Escape" && cancel()}
            >
              <label htmlFor={`rename-${flow.id}`} className="sr-only">
                Flow name
              </label>
              <Input id={`rename-${flow.id}`} ref={input} value={name} disabled={pending} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-8 font-semibold" />
              <label htmlFor={`goal-${flow.id}`} className="sr-only">
                Goal
              </label>
              <Input id={`goal-${flow.id}`} value={goal} disabled={pending} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="One sentence: what the user wants to have done" className="h-8 text-sm" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                  {pending ? "Saving…" : "Save"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <>
              <h2 className="font-semibold tracking-tight text-pretty">{flow.name}</h2>
              {flow.goal && <p className="mt-0.5 text-sm text-pretty text-muted-foreground">{flow.goal}</p>}
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-sm text-muted-foreground">
                {tested && (
                  <>
                    <span>{plural(states.length, "test")}</span>
                    <span aria-hidden="true">·</span>
                  </>
                )}
                {summary}
              </div>
            </>
          )}
        </div>
        {tested && <Health states={states} />}
        <div className={cx("absolute flex items-center gap-0.5 max-md:top-0 max-md:right-0 md:top-full md:left-3 md:mt-0.5", activeIds.length === 0 && REVEAL, "group-hover/flow:opacity-100")}>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Add a test to ${flow.name}`} title="Add a test" onClick={() => setAdding(true)} className="rounded-full text-muted-foreground hover:text-foreground">
            <Plus />
          </Button>
          {tested && <RunButton target={{ appId, flowId: flow.id }} active={activeIds.length > 0} stopIds={activeIds} label="Run flow" />}
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
                // autoFocus, because the menu still holds focus while it closes.
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
                {flow.goal ? "Rename or edit goal" : "Rename or set goal"}
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
                {deleting ? "Deleting…" : armed ? (tested ? "Delete flow and its tests?" : "Delete flow?") : "Delete flow"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="min-w-0">
        {adding && <AddTest appId={appId} flowId={flow.id} flowName={flow.name} onClose={() => setAdding(false)} />}
        {tested
          ? children
          : !adding && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(true)} className="-ml-3 mt-1.5 font-normal text-muted-foreground">
                <Plus aria-hidden="true" />
                Add the first test
              </Button>
            )}
      </div>
    </section>
  );
}
