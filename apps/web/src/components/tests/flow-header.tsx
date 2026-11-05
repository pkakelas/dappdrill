"use client";

import { Ellipsis, Plus } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteFlowAction, renameFlowAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import { AddTest } from "./add-test";
import { RunButton } from "./run-button";

export function FlowHeader({ appId, flow, count, summary, activeIds }: { appId: string; flow: { id: string; name: string }; count: number; summary: string; activeIds: string[] }) {
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
    <>
    <div className="flex items-center gap-1 border-b px-5 py-3">
      <div className="flex min-w-0 flex-1 items-baseline gap-x-3 max-sm:flex-col">
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
              className="h-8 max-w-80 text-base font-semibold"
            />
          </form>
        ) : (
          <h2 className="truncate font-semibold">{flow.name}</h2>
        )}
        <span className="shrink-0 text-sm text-muted-foreground">
          {plural(count, "test")} · {summary}
        </span>
      </div>
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
          align="end"
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
    {adding && <AddTest appId={appId} flowId={flow.id} flowName={flow.name} onClose={() => setAdding(false)} />}
    </>
  );
}
