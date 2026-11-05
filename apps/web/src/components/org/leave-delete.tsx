"use client";

import { useState } from "react";
import { deleteOrgAction, leaveOrgAction } from "@/actions/organization";
import { ActionForm } from "@/components/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LeaveOrg({ orgId, name }: { orgId: string; name: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-fit max-w-full">
          <span className="truncate">Leave {name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave {name}?</DialogTitle>
          <DialogDescription>You won&apos;t see its apps, tests or runs any more. To come back, someone has to invite you again.</DialogDescription>
        </DialogHeader>
        <ActionForm action={leaveOrgAction}>
          <input type="hidden" name="orgId" value={orgId} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Stay
              </Button>
            </DialogClose>
            <Button type="submit">Leave</Button>
          </DialogFooter>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Deleting asks for the organization's name, since it takes every app, test and run with it. */
export function DeleteOrg({ orgId, name, losing }: { orgId: string; name: string; losing: string }) {
  const [typed, setTyped] = useState("");
  return (
    <Dialog onOpenChange={() => setTyped("")}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-fit max-w-full">
          <span className="truncate">Delete {name}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {name}?</DialogTitle>
          <DialogDescription>This deletes {losing} for everyone in it. It can&apos;t be undone.</DialogDescription>
        </DialogHeader>
        <ActionForm action={deleteOrgAction}>
          <input type="hidden" name="orgId" value={orgId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="confirm-delete">
              Type <span className="font-semibold">{name}</span> to confirm
            </Label>
            <Input id="confirm-delete" name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Keep it
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={typed.trim() !== name.trim()}>
              Delete organization
            </Button>
          </DialogFooter>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
