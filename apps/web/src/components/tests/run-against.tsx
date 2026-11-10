"use client";

import { useState, useTransition } from "react";
import { runAgainstUrlAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "Run against…": every test, against another deploy of the app. Opens from a quiet button by Run all. */
export function RunAgainst({ appId, appUrl, disabled }: { appId: string; appUrl: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(appUrl);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setUrl(appUrl);
          setError(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" disabled={disabled}>
          Run against…
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await runAgainstUrlAction(appId, url);
              if (r.error) setError(r.error);
              else setOpen(false);
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Run against another URL</DialogTitle>
            <DialogDescription>A preview or staging deploy of this app. The tests and their saved steps are the app&apos;s own.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="run-against-url">URL</Label>
            <Input id="run-against-url" type="url" autoFocus inputMode="url" value={url} disabled={pending} onChange={(e) => setUrl(e.target.value)} placeholder="https://preview-123.vercel.app" />
            {error && <p className="text-sm text-bad">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending || url.trim().length === 0}>
              {pending ? "Starting…" : "Run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
