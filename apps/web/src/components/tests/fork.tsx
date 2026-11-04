"use client";

import { useState, useTransition } from "react";
import { forkTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** "Fork": a copy of this test with one change, described in a sentence. Opens as a popover under the button. */
export function Fork({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Fork
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(440px,calc(100vw-32px))] rounded-xl">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await forkTestAction(testId, text);
              if (r?.error) setError(r.error);
            });
          }}
        >
          <Label htmlFor="fork">The same test, but…</Label>
          <Input id="fork" autoFocus value={text} disabled={pending} onChange={(e) => setText(e.target.value)} placeholder="a limit sell instead of a market buy" />
          {error ? <p className="text-sm text-bad">{error}</p> : <p className="text-sm text-muted-foreground">The copy keeps what matches, rewrites what differs, then runs.</p>}
          <Button type="submit" size="sm" className="w-fit" disabled={pending || text.trim().length < 3}>
            {pending ? "Forking…" : "Fork and run"}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
