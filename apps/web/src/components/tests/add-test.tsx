"use client";

import { Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { makeTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";

const EMPTY = { does: "", sees: "" };

/**
 * Add a test, at the end of the list of tests: say what a user does and what they should see. It opens in
 * place. The worker does it once in the app, writes it as lines, and runs it until it goes the same way twice.
 */
export function AddTest({ appId, label = "Add a test" }: { appId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState(EMPTY);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const { does, sees } = answers;
  const ready = does.trim().length >= 8;
  const hasKey = looksLikeKey(does) || looksLikeKey(sees);

  const submit = () => {
    if (!ready || hasKey || pending) return;
    start(async () => {
      const goal = sees.trim() ? `${does.trim().replace(/[.\s]+$/, "")}. They should see: ${sees.trim()}` : does.trim();
      const r = await makeTestAction(appId, goal);
      if (r.error) return setError(r.error);
      setAnswers(EMPTY);
      setError(undefined);
      setOpen(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed">
          <Plus className="size-4" aria-hidden="true" />
        </span>
        {label}
      </button>
    );

  return (
    <form
      className="flex max-w-2xl flex-col gap-4 px-2 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="add-does">What should a user be able to do?</Label>
        <Textarea
          id="add-does"
          autoFocus
          rows={2}
          maxLength={300}
          disabled={pending}
          value={does}
          onChange={(e) => setAnswers({ ...answers, does: e.target.value })}
          placeholder="e.g. Withdraw 2.5 USDC from the vault"
          className="resize-none bg-background"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="add-sees">
          How do you know it worked? <span className="font-normal text-muted-foreground">Optional</span>
        </Label>
        <Input id="add-sees" maxLength={250} disabled={pending} value={sees} onChange={(e) => setAnswers({ ...answers, sees: e.target.value })} placeholder="e.g. Deposited falls by 2.50 USDC" className="bg-background" />
      </div>
      {(hasKey || error) && (
        <p role="alert" className="text-sm text-bad">
          {hasKey ? "That looks like a private key. This text isn't encrypted, so take it out." : error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!ready || hasKey || pending}>
          {pending ? "Starting…" : "Generate the test"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className="text-xs text-muted-foreground">We do it once in your app and write it down. Takes a few minutes.</span>
      </div>
    </form>
  );
}
