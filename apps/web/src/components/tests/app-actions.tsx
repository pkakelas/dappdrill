"use client";

import { Ellipsis, Globe, Sparkles, X } from "lucide-react";
import { useState, useTransition } from "react";
import { makeTestsAction, runAgainstUrlAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { RunButton } from "./run-button";

/** Every test, against another deploy of the app: the URL is asked for where the buttons were. */
function RunAgainst({ appId, appUrl, onClose }: { appId: string; appUrl: string; onClose: () => void }) {
  const [url, setUrl] = useState(appUrl);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-1.5 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await runAgainstUrlAction(appId, url);
          if (r.error) setError(r.error);
          else onClose();
        });
      }}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="flex w-full items-center gap-2">
        <Input
          type="url"
          inputMode="url"
          autoFocus
          aria-label="URL to run the tests against"
          value={url}
          disabled={pending}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          placeholder="https://preview-123.vercel.app"
          className="min-w-0 flex-1 sm:w-80 sm:flex-none"
        />
        <Button type="submit" disabled={pending || url.trim().length === 0}>
          {pending ? "Starting…" : "Run"}
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Cancel" disabled={pending} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <p role={error ? "alert" : undefined} className={error ? "text-xs text-bad" : "text-xs text-muted-foreground"}>
        {error ?? "A preview or staging deploy of this app. The tests are the app's own."}
      </p>
    </form>
  );
}

/**
 * What can be done with an app, as one button and a menu: Run all, and the rest behind "…". Before there are
 * tests the one button generates them. `making` is when tests are being generated already.
 */
export function AppActions({ appId, appUrl, tests, running, making, canMake }: { appId: string; appUrl: string; tests: number; running: boolean; making: boolean; canMake: boolean }) {
  const [against, setAgainst] = useState(false);
  const [starting, start] = useTransition();
  const generate = () => start(() => makeTestsAction(appId));

  if (tests === 0)
    return canMake && !making ? (
      <Button type="button" disabled={starting} onClick={generate}>
        {starting ? "Starting…" : "Generate tests"}
      </Button>
    ) : null;
  if (against) return <RunAgainst appId={appId} appUrl={appUrl} onClose={() => setAgainst(false)} />;
  return (
    <div className="flex items-center gap-2">
      <RunButton target={{ appId, all: true }} active={running} label="Run all" size="md" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" aria-label="More">
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuItem disabled={running} onSelect={() => setAgainst(true)}>
            <Globe aria-hidden="true" />
            Run against another URL
          </DropdownMenuItem>
          {canMake && (
            <DropdownMenuItem disabled={making || starting} onSelect={generate}>
              <Sparkles aria-hidden="true" />
              {making ? "Generating tests…" : "Explore again for more tests"}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
