"use client";

import { Plus, Wallet } from "lucide-react";
import { useState, useTransition } from "react";
import { makeTestAction } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";
import { StartsWith, type StartChoices, type Starts } from "./starts-with";
import { Tile } from "./tile";

const EMPTY = { does: "", sees: "" };

/**
 * Add a test: say what a user does and what they should see, in a dialog. The worker does it once in the app,
 * writes it as lines, and runs it until it goes the same way twice. `box` is the first line of the app's list
 * of tests; without it, it is a plain line to press.
 * `starts` is there on an app whose tests each get a new account: what this test's starts with can then be said.
 */
export function AddTest({ appId, label = "Add a test", starts, box }: { appId: string; label?: string; starts?: StartChoices; box?: boolean }) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState(EMPTY);
  const [fund, setFund] = useState<Starts>(null);
  // What the account starts with is one line until it is changed: most tests take what the app sends.
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const { does, sees } = answers;
  const ready = does.trim().length >= 8;
  const hasKey = looksLikeKey(does) || looksLikeKey(sees);

  const submit = () => {
    if (!ready || hasKey || pending) return;
    start(async () => {
      const goal = sees.trim() ? `${does.trim().replace(/[.\s]+$/, "")}. They should see: ${sees.trim()}` : does.trim();
      const r = await makeTestAction(appId, goal, undefined, starts ? fund : null);
      if (r.error) return setError(r.error);
      setAnswers(EMPTY);
      setFund(null);
      setChanging(false);
      setError(undefined);
      setOpen(false);
    });
  };

  return (
    <>
      {box ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left text-sm transition-colors outline-none hover:bg-foreground/[0.035] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed border-foreground/20 text-muted-foreground transition-colors group-hover:border-foreground/40 group-hover:text-foreground">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          <span className="shrink-0 font-medium whitespace-nowrap">{label}</span>
          <span className="hidden min-w-0 truncate text-muted-foreground sm:block">What should a user be able to do?</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground transition-colors outline-none hover:bg-foreground/[0.04] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed">
            <Plus className="size-4" aria-hidden="true" />
          </span>
          {label}
        </button>
      )}

      {/* What was typed stays when the dialog is closed, and goes once the test is on its way. */}
      <Dialog open={open} onOpenChange={(to) => !pending && setOpen(to)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <form
            className="flex flex-col"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
            }}
          >
            <DialogHeader className="px-6 pt-6 pr-12 text-left">
              <DialogTitle>Add a test</DialogTitle>
              <DialogDescription>Say it as you would to a colleague. We do it once in your app and write it down as steps.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-5 px-6 py-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-does">What should a user be able to do?</Label>
                <Textarea
                  id="add-does"
                  rows={3}
                  maxLength={300}
                  disabled={pending}
                  value={does}
                  onChange={(e) => setAnswers({ ...answers, does: e.target.value })}
                  placeholder="e.g. Withdraw 2.5 USDC from the vault"
                  className="min-h-20 resize-none"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="add-sees">
                  How do you know it worked? <span className="font-normal text-muted-foreground">Optional</span>
                </Label>
                <Input id="add-sees" maxLength={250} disabled={pending} value={sees} onChange={(e) => setAnswers({ ...answers, sees: e.target.value })} placeholder="e.g. Deposited falls by 2.50 USDC" />
              </div>
              {starts &&
                (changing ? (
                  <StartsWith id="add-starts-with" value={fund} onChange={setFund} choices={starts} disabled={pending} />
                ) : (
                  <div className="flex items-center gap-3 rounded-lg bg-muted/60 py-2 pr-2 pl-2.5 text-sm">
                    <Tile icon={Wallet} tint="live" className="size-8" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium">Runs on a new account</span>
                      <span className="truncate text-[13px] text-muted-foreground" title={starts.sends}>
                        It starts with {starts.sends}
                      </span>
                    </span>
                    <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setChanging(true)}>
                      Change
                    </Button>
                  </div>
                ))}
              {(hasKey || error) && (
                <p role="alert" className="text-sm text-bad">
                  {hasKey ? "That looks like a private key. This text isn't encrypted, so take it out." : error}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/40 px-6 py-4">
              <span className="mr-auto hidden text-xs text-muted-foreground sm:block">Takes a few minutes.</span>
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={pending}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!ready || hasKey || pending}>
                {pending ? "Starting…" : "Generate the test"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
