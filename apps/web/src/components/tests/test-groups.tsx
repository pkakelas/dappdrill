"use client";

import { Check, ChevronDown, Ellipsis, Folder, FolderOpen, ListChecks, Pencil, Ungroup } from "lucide-react";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { groupTestsAction, renameGroupAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import { RunButton } from "./run-button";
import type { TestItem } from "./test-item";
import { TINT } from "./tile";

/** As long as a group's name gets, here and where it is saved. */
const NAME_MAX = 40;

/** What the tests that name no group are listed under, once any test names one. */
export const NO_GROUP = "No group";

export type Grouped = Pick<TestItem, "id" | "name" | "group">;

/** What a dialog was last opened for, so its words stay as they were while it closes. */
function useLast<T>(value: T | undefined): T | undefined {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
}

/** The groups of an app the reader closed, kept in this browser so the list comes back the way it was left. A test with no group is under "". */
export function useFolded(appId: string): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const key = `dappdrill:folded:${appId}`;
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    try {
      const kept: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (Array.isArray(kept) && kept.length > 0) setFolded(new Set(kept.filter((k) => typeof k === "string")));
    } catch {
      // Nothing kept, or nothing can be: every group starts open.
    }
  }, [key]);
  return [
    folded,
    (next) => {
      setFolded(next);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        // It lasts for this visit only.
      }
    },
  ];
}

/**
 * The heading of a group in the app's list, set apart from the tests under it by its folder and its larger name:
 * pressing it opens and closes the group. Then how many tests it has and how they stand (`children`), the button
 * that runs them all, and what else can be done with the group.
 * `name` unset is the tests that name no group.
 */
export function GroupHead({
  appId,
  name,
  testIds,
  running,
  open,
  onToggle,
  onSelect,
  onRename,
  children,
}: {
  appId: string;
  name?: string;
  testIds: string[];
  running: number;
  open: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onRename: () => void;
  children: ReactNode;
}) {
  const [pending, start] = useTransition();
  const title = name ?? NO_GROUP;
  const Icon = open ? FolderOpen : Folder;
  return (
    <div className="group/head relative flex min-h-13 items-center gap-3 bg-muted/70 px-3.5 py-2 transition-colors hover:bg-muted">
      <span className={cx("flex size-7 shrink-0 items-center justify-center rounded-lg", name ? TINT.violet : "bg-foreground/[0.06] text-muted-foreground")}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className={cx("min-w-0 cursor-pointer truncate text-left text-[15px] tracking-tight outline-none after:absolute after:inset-0 focus-visible:underline", name ? "font-semibold" : "font-medium text-muted-foreground")}
        >
          {title}
        </button>
        <span className="shrink-0 rounded-full bg-foreground/[0.07] px-1.5 py-px text-[11px] font-medium text-muted-foreground tabular-nums">{testIds.length}</span>
      </span>
      <p className="hidden min-w-0 flex-1 items-center gap-x-3 overflow-hidden pl-1 text-xs whitespace-nowrap sm:flex">{children}</p>
      <span className="relative z-10 ml-auto flex shrink-0 items-center">
        <RunButton target={{ appId, testIds }} active={running > 0} label={name ? `Run ${name}` : "Run these tests"} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`More for ${title}`} className="rounded-full text-muted-foreground hover:text-foreground">
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={onSelect}>
              <ListChecks aria-hidden="true" />
              Select {testIds.length === 1 ? "its test" : `its ${testIds.length} tests`}
            </DropdownMenuItem>
            {name && (
              <>
                <DropdownMenuItem onSelect={onRename}>
                  <Pencil aria-hidden="true" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={pending} onSelect={() => start(async () => void (await renameGroupAction(appId, name, "")))}>
                  <Ungroup aria-hidden="true" />
                  Ungroup
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
      <ChevronDown aria-hidden="true" className={cx("pointer-events-none -ml-0.5 hidden size-4 shrink-0 text-muted-foreground transition-transform sm:block", open && "rotate-180")} />
    </div>
  );
}

/**
 * Where these tests are listed: under one of the app's groups, a new one, or none. Picking a group moves them
 * there and closes. `tests` unset is the dialog closed.
 */
export function MoveTests({ appId, tests: asked, groups, onClose, onDone }: { appId: string; tests?: Grouped[]; groups: { name: string; count: number }[]; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const tests = useLast(asked) ?? [];
  const one = tests.length === 1 ? tests[0] : undefined;
  // The group they are all in already, which is no place to move them to.
  const here = tests.length > 0 && tests.every((t) => t.group === tests[0]!.group) ? (tests[0]!.group ?? "") : undefined;
  const fresh = name.trim();

  const move = (to: string) =>
    start(async () => {
      const r = await groupTestsAction(
        appId,
        tests.map((t) => t.id),
        to,
      );
      setError(r.error);
      if (r.error) return;
      setName("");
      onDone();
    });
  const place = (to: string, label: ReactNode, count?: number) => (
    <li key={to}>
      <button
        type="button"
        disabled={pending || here === to}
        onClick={() => move(to)}
        className="flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors outline-none hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {here === to ? <Check aria-label="They are here now" className="size-4 text-muted-foreground" /> : count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
      </button>
    </li>
  );

  return (
    <Dialog
      open={Boolean(asked)}
      onOpenChange={(open) => {
        if (open || pending) return;
        setError(undefined);
        onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-md">
        <DialogHeader className="px-6 pt-6 pr-12 text-left">
          <DialogTitle>{one ? "Move to a group" : `Move ${plural(tests.length, "test")} to a group`}</DialogTitle>
          <DialogDescription>{one ? `“${one.name}”` : "They are listed together under the group's name, and can be run together."}</DialogDescription>
        </DialogHeader>

        {groups.length > 0 && (
          <ul className="flex flex-col px-3 pt-4">
            {groups.map((g) => place(g.name, <span className="font-medium">{g.name}</span>, g.count))}
            {tests.some((t) => t.group) && place("", <span className="text-muted-foreground">{NO_GROUP}</span>)}
          </ul>
        )}

        <form
          className="flex flex-col gap-2 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (fresh && !pending) move(fresh);
          }}
        >
          <label htmlFor="move-new-group" className="text-sm leading-none font-medium">
            {groups.length > 0 ? "Or a new group" : "Name the group"}
          </label>
          <div className="flex gap-2">
            <Input id="move-new-group" autoFocus={groups.length === 0} autoComplete="off" maxLength={NAME_MAX} disabled={pending} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Deposits" />
            <Button type="submit" disabled={!fresh || pending}>
              {pending ? "Moving…" : "Move"}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : (
            <p className="text-xs text-pretty text-muted-foreground">What a user is doing there, in a few words. A group is there for as long as a test is in it.</p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Another name for a group. A name another group has puts the tests of both under it. `group` unset is the dialog closed. */
export function RenameGroup({ appId, group: asked, groups, onClose }: { appId: string; group?: string; groups: { name: string; count: number }[]; onClose: () => void }) {
  const [name, setName] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const group = useLast(asked) ?? "";
  const next = (name ?? group).trim();
  const joins = groups.find((g) => g.name === next && g.name !== group);
  const close = () => {
    setName(undefined);
    setError(undefined);
    onClose();
  };
  return (
    <Dialog open={asked !== undefined} onOpenChange={(open) => !open && !pending && close()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!next || next === group) return close();
            start(async () => {
              const r = await renameGroupAction(appId, group, next);
              if (r.error) return setError(r.error);
              close();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename the group</DialogTitle>
            <DialogDescription>Its tests stay as they are, under the new name.</DialogDescription>
          </DialogHeader>
          <Input aria-label="The group's name" autoFocus autoComplete="off" maxLength={NAME_MAX} disabled={pending} value={name ?? group} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
          {(error || joins) && (
            <p role={error ? "alert" : undefined} className={cx("text-sm text-pretty", error ? "text-bad" : "text-muted-foreground")}>
              {error ?? `There is a group with this name already: these tests join the ${joins!.count} under it.`}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !next}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
