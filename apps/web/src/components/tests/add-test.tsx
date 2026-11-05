"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addTestAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** One sentence; the worker writes the steps and runs it. */
export function AddTest({ appId, placeholder = "e.g. Withdraw half and check the balance", onAdded, className }: { appId: string; placeholder?: string; onAdded?: () => void; className?: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ready = text.trim().length >= 3;

  return (
    <form
      className={cx("flex flex-col gap-1", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        start(async () => {
          const r = await addTestAction(appId, text);
          if (r.error) return setError(r.error);
          setText("");
          setError(undefined);
          onAdded?.();
        });
      }}
    >
      <div className="relative">
        <Plus aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-sky-600" />
        <Input
          aria-label="Add a test"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          placeholder={placeholder}
          className={cx("h-9 bg-background pl-9 transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25", ready && "pr-28")}
        />
        {ready && (
          <Button type="submit" size="xs" disabled={pending} className="absolute top-1/2 right-1.5 -translate-y-1/2">
            {pending ? "Adding…" : "Write and run"}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
    </form>
  );
}

/** Sits beside Run all. A new test lands on the Tests tab, so that's where this ends up from the other tabs. */
export function AddTestButton({ appId }: { appId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Plus aria-hidden="true" />
          Add test
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>What else should we test?</DialogTitle>
          <DialogDescription>One sentence is enough. DappDrill writes the steps and runs it.</DialogDescription>
        </DialogHeader>
        <AddTest
          appId={appId}
          onAdded={() => {
            setOpen(false);
            router.push(`/apps/${appId}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
