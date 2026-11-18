"use client";

import { Ellipsis, Globe, ListPlus, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { makeTestsAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AddTestButton, AddTestDialog } from "./add-test";
import { RunAgainstDialog } from "./run-against";
import { RunButton } from "./run-button";

/**
 * What can be done with an app, as one button and a menu: Run all once there are tests (Add test before),
 * and the rest behind "…". `making` is when tests are being made already: a test added meanwhile waits its turn.
 */
export function AppActions({ appId, appUrl, tests, running, making, canMake }: { appId: string; appUrl: string; tests: number; running: boolean; making: boolean; canMake: boolean }) {
  const [dialog, setDialog] = useState<"add" | "against">();
  const [starting, start] = useTransition();

  if (tests === 0) return <AddTestButton appId={appId} />;
  return (
    <div className="flex items-center gap-2">
      <RunButton target={{ appId, all: true }} active={running} label="Run all" size="md" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="More">
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setDialog("add")}>
            <Plus aria-hidden="true" />
            Add a test
          </DropdownMenuItem>
          {canMake && (
            <DropdownMenuItem disabled={making || starting} onSelect={() => start(() => makeTestsAction(appId))}>
              <ListPlus aria-hidden="true" />
              {making ? "Making tests…" : "Make more tests"}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={running} onSelect={() => setDialog("against")}>
            <Globe aria-hidden="true" />
            Run against another URL
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddTestDialog appId={appId} open={dialog === "add"} onOpenChange={(open) => setDialog(open ? "add" : undefined)} />
      <RunAgainstDialog appId={appId} appUrl={appUrl} open={dialog === "against"} onOpenChange={(open) => setDialog(open ? "against" : undefined)} />
    </div>
  );
}
