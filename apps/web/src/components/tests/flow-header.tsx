"use client";

import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { deleteFlowAction, renameFlowAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import { RunButton } from "./run-button";

export function FlowHeader({ appId, flow, count, summary, activeIds }: { appId: string; flow: { id: string; name: string; goal: string | null }; count: number; summary: ReactNode; activeIds: string[] }) {
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

  return (
    <div className="flex items-center gap-3 border-b px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
            <Input id={`rename-${flow.id}`} ref={input} value={name} disabled={pending} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-8 max-w-80 text-base font-semibold" />
            <label htmlFor={`goal-${flow.id}`} className="sr-only">
              Goal
            </label>
            <Input id={`goal-${flow.id}`} value={goal} disabled={pending} onChange={(e) => setGoal(e.target.value)} maxLength={300} placeholder="One sentence: what the user wants to have done" className="h-8 max-w-xl text-sm" />
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
            <h2 className="truncate text-base font-semibold">{flow.name}</h2>
            {flow.goal && <p className="truncate text-sm text-muted-foreground">{flow.goal}</p>}
          </>
        )}
        {!renaming && (
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {count > 0 && (
              <>
                <span>{plural(count, "test")}</span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {summary}
          </span>
        )}
      </div>
      {count > 0 && <RunButton target={{ appId, flowId: flow.id }} active={activeIds.length > 0} stopIds={activeIds} label="Run flow" size="sm" />}
      <DropdownMenu onOpenChange={(open) => !open && setArmed(false)}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More for ${flow.name}`} className="text-muted-foreground">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
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
            {deleting ? "Deleting…" : armed ? (count > 0 ? "Delete flow and its tests?" : "Delete flow?") : "Delete flow"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
