"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { RunButton } from "./run-button";

/** What can be done with a test: Run, and the rest behind "…". Editing is the page with `?edit`. */
export function TestActions({ appId, testId, active }: { appId: string; testId: string; active: boolean }) {
  const [deleting, setDeleting] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <RunButton target={{ appId, testIds: [testId] }} active={active} stopIds={[testId]} label="Run" size="md" primary />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="More">
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem asChild disabled={active}>
            <Link href={`/apps/${appId}/tests/${testId}?edit`}>
              <Pencil aria-hidden="true" />
              Edit the test
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this test?</DialogTitle>
            <DialogDescription>Its results go with it. This can&apos;t be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => start(() => deleteTestAction(testId))}>
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
