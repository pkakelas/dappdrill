"use client";

import { Bug, ChevronDown, Copy, Ellipsis, Globe, Pencil, SquareArrowOutUpRight, Trash2, Wrench } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { duplicateTestAction, repairTestsAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RunButton } from "./run-button";
import { StateMark } from "./status";
import type { TestItem } from "./test-item";
import { TestOpened } from "./test-opened";

/** Where a pointer can rest on a line, what can be done with it takes the place of its time; elsewhere both show. */
const GIVES_WAY = "transition-opacity [@media(hover:hover)]:group-hover/test:opacity-0 [@media(hover:hover)]:group-has-[[data-acts]_:focus-visible]/test:opacity-0 [@media(hover:hover)]:group-has-[[data-acts]_[data-state=open]]/test:opacity-0";
const TAKES_OVER =
  "transition-opacity [@media(hover:hover)]:absolute [@media(hover:hover)]:right-0 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/test:opacity-100 [@media(hover:hover)]:has-[:focus-visible]:opacity-100 [@media(hover:hover)]:has-[[data-state=open]]:opacity-100";

/** How a test stands as a tinted tile: a bug the test found, a test a run can't do as it is, or its last result. */
function Stand({ item }: { item: TestItem }) {
  if (item.stands === "bug")
    return (
      <span role="img" aria-label="Bug found" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600">
        <Bug className="size-4" aria-hidden="true" />
      </span>
    );
  if (item.stands === "repair")
    return (
      <span role="img" aria-label="Needs repair" className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
        <Wrench className="size-4" aria-hidden="true" />
      </span>
    );
  return <StateMark state={item.mark} size="lg" />;
}

/**
 * A test as one line of the app's list: how it stands, its name with what went wrong under it, and when it
 * last ran. Its name opens it in place. The box that picks it for what is done to several takes the place of
 * its mark under the pointer, and what can be done with it the place of its time.
 */
export function TestRow({
  appId,
  appUrl,
  item,
  open,
  onOpen,
  selected,
  onSelect,
  onDelete,
  onRunAgainst,
}: {
  appId: string;
  appUrl: string;
  item: TestItem;
  open: boolean;
  onOpen: () => void;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onDelete: () => void;
  onRunAgainst: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const repair = item.stands === "repair";
  const active = Boolean(item.now);
  const href = `/apps/${appId}/tests/${item.id}`;
  // The last words on the line give way to its actions; a status with a time after it stays.
  const stays = item.now ? undefined : item.when ? item.label : undefined;
  const gives = item.now ? undefined : (item.when ?? item.label);
  return (
    <li className={cx("p-1.5", item.fresh && "animate-in duration-500 fade-in-0 slide-in-from-top-2 motion-reduce:animate-none")}>
      <div className={cx("group/test relative flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 transition-colors", open ? "items-start" : "hover:bg-foreground/[0.035]", selected && "bg-foreground/[0.035]")}>
        <span className="relative flex size-7 shrink-0 items-center justify-center">
          <span className={cx("flex transition-opacity", selected ? "opacity-0" : "group-has-[[role=checkbox]:focus-visible]/test:opacity-0 [@media(hover:hover)]:group-hover/test:opacity-0")}>
            <Stand item={item} />
          </span>
          <Checkbox
            checked={selected}
            onCheckedChange={(on) => onSelect(on === true)}
            aria-label={`Select ${item.name}`}
            className={cx("absolute z-10 bg-background transition-opacity after:absolute after:-inset-1.5", !selected && "opacity-0 focus-visible:opacity-100 [@media(hover:hover)]:group-hover/test:opacity-100")}
          />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cx("flex min-w-0 gap-2", open ? "items-start pt-1" : "items-center")}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`lines-${item.id}`}
              onClick={onOpen}
              className={cx("min-w-0 cursor-pointer text-left text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:underline", open ? "text-pretty" : "max-sm:line-clamp-2 sm:truncate")}
            >
              {item.name}
            </button>
            {item.fresh && <span className="shrink-0 rounded-full bg-live-soft px-1.5 py-px text-[11px] font-medium text-live">New</span>}
          </span>
          {item.note && !open && (
            <p className={cx("truncate text-[13px]", item.note.tone)} title={item.note.text}>
              {item.note.text}
            </p>
          )}
        </div>
        <span className={cx("flex shrink-0 items-center gap-2.5 text-xs tabular-nums", open && "h-7")}>
          {item.now && <span className="hidden font-medium text-live sm:inline">{item.now}</span>}
          {stays && <span className={cx("hidden font-medium sm:inline", item.tone)}>{stays}</span>}
          <span className="relative flex items-center justify-end [@media(hover:hover)]:min-w-16">
            {gives && <span className={cx("hidden whitespace-nowrap sm:inline", item.when ? "text-muted-foreground" : cx("font-medium", item.tone), GIVES_WAY)}>{gives}</span>}
            <span data-acts className={cx("relative z-10 flex items-center", !active && TAKES_OVER)}>
              <RunButton target={{ appId, testIds: [item.id] }} active={active} label="Run test" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`More for ${item.name}`} className="rounded-full text-muted-foreground hover:text-foreground">
                    <Ellipsis aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem asChild>
                    <Link href={href}>
                      <SquareArrowOutUpRight aria-hidden="true" />
                      Open the test
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild disabled={active}>
                    <Link href={`${href}?edit`}>
                      <Pencil aria-hidden="true" />
                      Edit
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={pending} onSelect={() => start(() => duplicateTestAction(item.id))}>
                    <Copy aria-hidden="true" />
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={active} onSelect={onRunAgainst}>
                    <Globe aria-hidden="true" />
                    Run against another URL
                  </DropdownMenuItem>
                  {repair && (
                    <DropdownMenuItem disabled={pending} onSelect={() => start(async () => setError((await repairTestsAction(appId, [item.id])).error))}>
                      <Wrench aria-hidden="true" />
                      Repair
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                    <Trash2 aria-hidden="true" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </span>
          <ChevronDown aria-hidden="true" className={cx("pointer-events-none hidden size-4 text-muted-foreground/50 transition-transform sm:block", open && "rotate-180")} />
        </span>
      </div>
      {error && (
        <p role="alert" className="px-2 pb-1 text-sm text-bad sm:pl-12">
          {error}
        </p>
      )}
      {open && <TestOpened appId={appId} appUrl={appUrl} item={item} href={href} />}
    </li>
  );
}
