"use client";

import { BadgeCheck, Plus, Route, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { makeTestAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";
import { Tile, type TINT } from "./tile";

const FIELD = "bg-background px-3.5 transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25";
const EMPTY = { does: "", sees: "" };

/** Label on the left, input on the right, the way the New app page asks. */
function Question({ icon, tint, title, detail, htmlFor, children }: { icon: LucideIcon; tint: keyof typeof TINT; title: string; detail: ReactNode; htmlFor: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-8">
      <div className="flex gap-3">
        <Tile icon={icon} tint={tint} />
        <div className="flex flex-col gap-0.5">
          <Label htmlFor={htmlFor} className="leading-snug">
            {title}
          </Label>
          <p className="text-sm text-pretty text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

/**
 * Add a test: say what a user does and what they should see. The worker does it once in the app,
 * writes it as lines, and runs it until it goes the same way twice.
 */
export function AddTestButton({ appId, label = "Add test" }: { appId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        {label}
      </Button>
      <AddTestDialog appId={appId} open={open} onOpenChange={setOpen} />
    </>
  );
}

/** The Add a test form, opened by its button or from the app's menu. */
export function AddTestDialog({ appId, open, onOpenChange: setOpen }: { appId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [answers, setAnswers] = useState(EMPTY);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
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
      router.push(`/apps/${appId}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent overlayClassName="bg-black/65 backdrop-blur-[3px]" className="flex max-h-[min(92vh,880px)] flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-3xl">
        <DialogHeader className="gap-1.5 border-b px-6 pt-7 pb-6 sm:px-8">
          <DialogTitle className="text-2xl tracking-tight">Add a test</DialogTitle>
          <DialogDescription className="text-pretty">We do it once in your app, write it down as a test, and run it until it goes the same way twice.</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
          }}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 pt-7 pb-8 sm:px-8">
            <Question icon={Route} tint="live" title="What does the user do?" detail="One thing, start to finish, with the amounts to use." htmlFor="add-goal">
              <Textarea
                id="add-goal"
                autoFocus
                rows={3}
                maxLength={300}
                disabled={pending}
                value={does}
                onChange={(e) => setAnswers({ ...answers, does: e.target.value })}
                placeholder="e.g. Withdraw 2.5 USDC from the vault"
                className={cx("min-h-20 resize-none py-3", FIELD)}
              />
            </Question>
            <Question icon={BadgeCheck} tint="good" title="How do you know it worked?" detail="What the page shows at the end. Leave it out and we work it out from the app." htmlFor="add-sees">
              <Input id="add-sees" maxLength={250} disabled={pending} value={sees} onChange={(e) => setAnswers({ ...answers, sees: e.target.value })} placeholder="e.g. Deposited falls by 2.50 USDC" className={cx("h-11", FIELD)} />
            </Question>
          </div>

          <DialogFooter className="items-center gap-3 border-t bg-muted/40 px-6 py-4 sm:justify-between sm:px-8">
            {hasKey || error ? (
              <p role="alert" className="text-sm text-bad">
                {hasKey ? "That looks like a private key. This text isn't encrypted, so take it out." : error}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">This takes a few minutes. You can watch it on the app&apos;s page.</p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!ready || hasKey || pending}>
                {pending ? "Starting…" : "Make the test"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
