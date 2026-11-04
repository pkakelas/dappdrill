"use client";

import { useState, useTransition } from "react";
import { deleteFlowAction, renameFlowAction } from "@/actions/tests";
import { ConfirmButton } from "@/components/confirm-button";
import { Menu, MenuItem, menuLinkClass } from "@/components/shell/menu";
import { plural } from "@/lib/format";
import { RunButton } from "./run-button";

export function FlowHeader({
  appId,
  flow,
  count,
  summary,
  activeIds,
}: {
  appId: string;
  flow: { id: string; name: string };
  count: number;
  summary: string;
  activeIds: string[];
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(flow.name);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      if (name.trim() && name.trim() !== flow.name) await renameFlowAction(flow.id, name);
      setRenaming(false);
    });

  return (
    <div className="flex items-center gap-3 border-b border-divide px-5 py-3.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
            <input
              id={`rename-${flow.id}`}
              autoFocus
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
              className="field h-9 max-w-[320px] font-serif text-[19px]"
            />
          </form>
        ) : (
          <h2 className="h2 truncate text-[20px]">{flow.name}</h2>
        )}
        <span className="font-mono text-[11px] text-muted">
          {plural(count, "test")} · {summary}
        </span>
      </div>
      <RunButton target={{ appId, flowId: flow.id }} active={activeIds.length > 0} stopIds={activeIds} label="Run flow" size="sm" />
      <Menu
        label={`More for ${flow.name}`}
        align="right"
        buttonClassName="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-ink-3 hover:bg-sub hover:text-ink"
        button={
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <circle cx="3.5" cy="8" r="1.3" />
            <circle cx="8" cy="8" r="1.3" />
            <circle cx="12.5" cy="8" r="1.3" />
          </svg>
        }
      >
        <MenuItem>
          <button type="button" className={menuLinkClass} onClick={() => setRenaming(true)}>
            Rename
          </button>
        </MenuItem>
        <MenuItem>
          <ConfirmButton className={menuLinkClass} confirm="Delete flow and its tests?" onConfirm={() => deleteFlowAction(flow.id)}>
            Delete flow
          </ConfirmButton>
        </MenuItem>
      </Menu>
    </div>
  );
}
