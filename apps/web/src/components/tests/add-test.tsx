"use client";

import { BadgeCheck, CircleDollarSign, GitFork, ListOrdered, MapPin, Plus, Route, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { addTestAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";
import { Tile, type TINT } from "./tile";

const FIELD = "bg-background px-3.5 transition-colors placeholder:text-muted-foreground/80 hover:border-foreground/25";
const SELECT = cx("h-11 w-full data-[size=default]:h-11", FIELD);
const FRESH = "fresh";
/** No start page picked: the writer chooses one. */
const ANY = "any";
const EMPTY = { goal: "", expected: "", startPath: "", amounts: "", steps: "", like: FRESH };

export type AddTestProps = {
  appId: string;
  /** Pages the app map knows, offered as places to start. Without any, the start page is typed. */
  pages?: { path: string; purpose: string }[];
  /** Tests a new one can be written from. */
  tests?: { id: string; name: string }[];
  /** What the app's setup does before every test. */
  setup?: string[];
  label?: string;
};

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
 * Add test: a few questions, then the worker writes the steps and runs them. The first two are
 * needed (the writer starts from the goal, the judge checks the expected result on every run);
 * the rest save the writer a guess. A new test lands on the Tests tab, so that's where this ends up.
 */
export function AddTestButton({ appId, pages = [], tests = [], setup = [], label = "Add test" }: AddTestProps) {
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState(EMPTY);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (key: keyof typeof EMPTY) => (value: string) => setAnswers((current) => ({ ...current, [key]: value }));
  const { goal, expected, startPath, amounts, steps, like } = answers;
  const ready = goal.trim().length >= 3 && expected.trim().length >= 3;
  // The map keeps the query a page was seen with (?fromChainId=…); a test starts on the page itself.
  const starts = [...new Set(pages.map((page) => page.path.split(/[?#]/)[0] || "/"))];
  const hasKey = [goal, expected, startPath, amounts, steps].some(looksLikeKey);

  const submit = () => {
    if (!ready || hasKey || pending) return;
    start(async () => {
      // "1. Open the vault" and "- Open the vault" are the same step.
      const lines = steps.split("\n").map((line) => line.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, ""));
      const r = await addTestAction(appId, { goal, expected, startPath, amounts, steps: lines }, like === FRESH ? undefined : like);
      if (r.error) return setError(r.error);
      setAnswers(EMPTY);
      setError(undefined);
      setOpen(false);
      router.push(`/apps/${appId}`);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Plus aria-hidden="true" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent overlayClassName="bg-black/65 backdrop-blur-[3px]" className="flex max-h-[min(92vh,880px)] flex-col gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl sm:max-w-5xl">
        <DialogHeader className="gap-1.5 border-b px-6 pt-7 pb-6 sm:px-8">
          <DialogTitle className="text-2xl tracking-tight">Add a test</DialogTitle>
          <DialogDescription className="text-pretty">We write the steps from your answers and run the test right away.</DialogDescription>
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
            <Question icon={Route} tint="live" title="What does the user do?" detail="One thing, start to finish." htmlFor="add-goal">
              <Textarea id="add-goal" autoFocus rows={2} maxLength={300} disabled={pending} value={goal} onChange={(e) => set("goal")(e.target.value)} placeholder="e.g. Withdraw half of the deposit from the vault" className={cx("min-h-20 resize-none py-3", FIELD)} />
            </Question>
            <Question icon={BadgeCheck} tint="good" title="How do you know it worked?" detail="What the page shows at the end. We check it on every run." htmlFor="add-expected">
              <Input id="add-expected" maxLength={300} disabled={pending} value={expected} onChange={(e) => set("expected")(e.target.value)} placeholder="e.g. Deposited shows 2.50 USDC" className={cx("h-11", FIELD)} />
            </Question>

            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t pt-6">
              <h3 className="text-sm font-medium">Optional</h3>
              <p className="text-sm text-muted-foreground">What you leave out, we work out from the app.</p>
            </div>

            <Question icon={MapPin} tint="fork" title="Where does it start?" detail="The page the test opens first." htmlFor="add-start">
              {starts.length > 0 ? (
                <Select value={startPath || ANY} onValueChange={(value) => set("startPath")(value === ANY ? "" : value)} disabled={pending}>
                  <SelectTrigger id="add-start" className={SELECT}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>Let us pick</SelectItem>
                    {starts.map((path) => (
                      <SelectItem key={path} value={path}>
                        {path}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input id="add-start" maxLength={200} disabled={pending} value={startPath} onChange={(e) => set("startPath")(e.target.value)} placeholder="e.g. /vault" className={cx("h-11", FIELD)} />
              )}
            </Question>
            <Question
              icon={CircleDollarSign}
              tint="warn"
              title="Which tokens and amounts?"
              detail={setup.length > 0 ? "What the test types. The wallet has the native coin and what setup gives it." : "What the test types. The wallet starts with the native coin."}
              htmlFor="add-amounts"
            >
              <Input id="add-amounts" maxLength={300} disabled={pending} value={amounts} onChange={(e) => set("amounts")(e.target.value)} placeholder="e.g. 2.5 USDC" className={cx("h-11", FIELD)} />
            </Question>
            <Question icon={ListOrdered} tint="pink" title="Any steps we should follow?" detail="One per line, the way a user would say them." htmlFor="add-steps">
              <Textarea
                id="add-steps"
                rows={3}
                disabled={pending}
                value={steps}
                onChange={(e) => set("steps")(e.target.value)}
                placeholder={"Open the vault\nEnter 2.5 as the amount\nClick Withdraw"}
                className={cx("min-h-24 resize-none py-3", FIELD)}
              />
              {setup.length > 0 && (
                <p className="text-sm text-pretty text-muted-foreground">
                  Setup runs first, so leave it out: {setup.slice(0, 4).join(", ")}
                  {setup.length > 4 ? "…" : "."}
                </p>
              )}
            </Question>
            {tests.length > 0 && (
              <Question icon={GitFork} tint="live" title="Is it like a test you have?" detail="The steps they share keep what was recorded, so it runs sooner." htmlFor="add-like">
                <Select value={like} onValueChange={set("like")} disabled={pending}>
                  <SelectTrigger id="add-like" className={SELECT}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FRESH}>No, start fresh</SelectItem>
                    {tests.map((test) => (
                      <SelectItem key={test.id} value={test.id}>
                        {test.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Question>
            )}
          </div>

          <DialogFooter className="items-center gap-3 border-t bg-muted/40 px-6 py-4 sm:justify-between sm:px-8">
            {hasKey || error ? (
              <p role="alert" className="text-sm text-bad">
                {hasKey ? "That looks like a private key. This text isn't encrypted, so take it out." : error}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{ready ? "It runs as soon as the steps are written." : "The first two answers are needed."}</p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <DialogClose asChild>
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={!ready || hasKey || pending}>
                {pending ? "Adding…" : "Write and run"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
