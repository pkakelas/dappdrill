"use client";

import { Group, Play, Trash2, Wrench, X } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteTestsAction, repairTestsAction, runAgainstUrlAction, runTestsAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import type { TestItem } from "./test-item";

export type Picked = Pick<TestItem, "id" | "name" | "stands" | "group">;

/** What a dialog was last opened for, so its words stay as they were while it closes. */
function useLast<T>(value: T | undefined): T | undefined {
  const [last, setLast] = useState(value);
  if (value !== undefined && value !== last) setLast(value);
  return value ?? last;
}

/**
 * What can be done to the tests picked in the list, on a bar that stays at the bottom of the window while
 * any is picked. `more` is how many of the tests shown aren't picked yet.
 */
export function SelectionBar({ appId, picked, more, onAll, onClear, onDelete, onMove }: { appId: string; picked: Picked[]; more: number; onAll: () => void; onClear: () => void; onDelete: () => void; onMove: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const ids = picked.map((t) => t.id);
  const broken = picked.filter((t) => t.stands === "repair").map((t) => t.id);
  return (
    <div className="pointer-events-none sticky bottom-4 z-20 flex justify-center">
      <div
        role="toolbar"
        aria-label="Selected tests"
        className="pointer-events-auto flex max-w-full animate-in flex-wrap items-center gap-1 rounded-xl border bg-background p-1.5 pl-3.5 text-sm shadow-lg duration-200 fade-in-0 slide-in-from-bottom-2 motion-reduce:animate-none"
      >
        <span className="mr-1.5 font-medium tabular-nums">{picked.length} selected</span>
        {error && (
          <span role="alert" className="mr-1.5 text-bad">
            {error}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await runTestsAction(appId, ids);
              onClear();
            })
          }
        >
          <Play className="size-3.5 fill-current" aria-hidden="true" />
          Run
        </Button>
        {broken.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await repairTestsAction(appId, broken);
                setError(r.error);
                if (!r.error) onClear();
              })
            }
          >
            <Wrench aria-hidden="true" />
            Repair{broken.length < picked.length ? ` ${broken.length}` : ""}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onMove}>
          <Group aria-hidden="true" />
          Group
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onDelete} className="text-bad hover:text-bad">
          <Trash2 aria-hidden="true" />
          Delete
        </Button>
        {more > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={onAll}>
            Select all
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear the selection" onClick={onClear}>
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

/** Asks before these tests are deleted. `tests` unset is the dialog closed. */
export function DeleteTests({ appId, tests: asked, onClose, onDone }: { appId: string; tests?: Picked[]; onClose: () => void; onDone: () => void }) {
  const [pending, start] = useTransition();
  const tests = useLast(asked);
  const one = tests?.length === 1 ? tests[0] : undefined;
  return (
    <Dialog open={Boolean(asked)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{one ? "Delete this test?" : `Delete ${plural(tests?.length ?? 0, "test")}?`}</DialogTitle>
          <DialogDescription>{one ? `“${one.name}” and its results go.` : "Their results go with them."} This can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="ghost">
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await deleteTestsAction(
                  appId,
                  (tests ?? []).map((t) => t.id),
                );
                onDone();
              })
            }
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One test, against another deploy of the app: asks for the URL. `test` unset is the dialog closed. */
export function RunAgainst({ appId, appUrl, test: asked, onClose }: { appId: string; appUrl: string; test?: Picked; onClose: () => void }) {
  const [url, setUrl] = useState(appUrl);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const test = useLast(asked);
  return (
    <Dialog open={Boolean(asked)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!test) return;
            start(async () => {
              const r = await runAgainstUrlAction(appId, url, [test.id]);
              setError(r.error);
              if (!r.error) onClose();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Run against another URL</DialogTitle>
            <DialogDescription>A preview or staging deploy of this app. “{test?.name}” runs there as it is.</DialogDescription>
          </DialogHeader>
          <Input
            type="url"
            inputMode="url"
            autoFocus
            aria-label="URL to run the test against"
            value={url}
            disabled={pending}
            onChange={(e) => setUrl(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="https://preview-123.vercel.app"
          />
          {error && (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || url.trim().length === 0}>
              {pending ? "Starting…" : "Run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
