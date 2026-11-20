"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissGoalAction, makeTestAction, type GoalRef } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";
import { Need } from "./needs-you";

const KEY = "That looks like a private key. This text isn't encrypted, so take it out.";

/** The goal with the owner's answer added to it, as the test maker reads it. */
const withAnswer = (goal: string, answer: string) => `${goal.trim().replace(/[.\s]+$/, "")}. Good to know: ${answer.trim()}`;

/** Something we couldn't write a test for: what a user does, the page that says what we tried, and where it is among the makes. */
export interface OpenGoal {
  goal: string;
  href: string;
  ref: GoalRef;
}

/**
 * What we couldn't write a test for, on the app's list of what needs its owner: our question when we have one,
 * else why there is no test. Several that wait on the same question, or stopped for the same reason, are one
 * item, so one answer does for all of them. Answering opens a field in place, and the tests are generated again
 * with the answer. Without an answer there is nothing new to try, so the only other choice is to dismiss it.
 * `locked` is while tests are being generated, when nothing here can be changed yet.
 */
export function GoalNeed({ appId, goals, ask, why, locked }: { appId: string; goals: OpenGoal[]; ask?: string; why?: string; locked?: boolean }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const hasKey = looksLikeKey(answer);
  const ready = answer.trim().length > 0 && !hasKey;
  const [one] = goals;
  const many = goals.length > 1;

  const retry = () =>
    start(async () => {
      for (const g of goals) {
        const r = await makeTestAction(appId, withAnswer(g.goal, answer), g.ref);
        if (r.error) return setError(r.error);
      }
      setOpen(false);
    });
  const dismiss = () =>
    start(async () => {
      for (const g of goals) await dismissGoalAction(appId, g.ref);
    });

  return (
    <Need
      title={!many ? one!.goal : ask ? `${goals.length} tests wait on one answer` : `${goals.length} tests we couldn't write, for one reason`}
      actions={
        !locked &&
        !open && (
          <>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setOpen(true)}>
              Answer
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={many ? `Dismiss all ${goals.length}` : "Dismiss"}
              title={many ? `Dismiss all ${goals.length}` : "Dismiss"}
              disabled={pending}
              onClick={dismiss}
              className="text-muted-foreground"
            >
              <X aria-hidden="true" />
            </Button>
          </>
        )
      }
      below={
        open && (
          <form
            className="flex max-w-3xl flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (ready) retry();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) retry();
              if (e.key === "Escape") setOpen(false);
            }}
          >
            {!ask && (
              <p className="text-sm text-pretty">
                Anything we should know? <span className="text-muted-foreground">A step first, the amount to use, how long it takes to show.</span>
              </p>
            )}
            <Textarea
              aria-label={ask ? "Your answer" : "Anything we should know"}
              autoFocus
              rows={2}
              maxLength={300}
              disabled={pending}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={ask ? "Your answer, in a sentence" : "e.g. Withdrawals take a minute to show. Use 1 USDC."}
              className="resize-none bg-background"
            />
            {(hasKey || error) && (
              <p role="alert" className="text-sm text-bad">
                {hasKey ? KEY : error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={pending || !ready}>
                {pending ? "Starting…" : many ? `Generate the ${goals.length} tests again` : "Generate the test again"}
              </Button>
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <span className="text-xs text-muted-foreground">Takes a few minutes{many ? " each" : ""}.</span>
            </div>
          </form>
        )
      }
    >
      {ask && <p className="text-foreground">{ask}</p>}
      {why && <p className={ask ? "line-clamp-2" : "line-clamp-3"}>{why}</p>}
      {many ? (
        <details className="group/all">
          <summary className="w-fit cursor-pointer list-none underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span className="group-open/all:hidden">Show the {goals.length} tests</span>
            <span className="hidden group-open/all:inline">Hide them</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5 border-l-2 pl-3.5">
            {goals.map((g) => (
              <li key={`${g.ref.makeId}:${g.ref.index}`}>
                <Link href={g.href} className="text-pretty text-foreground hover:underline hover:underline-offset-4">
                  {g.goal}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p>
          <Link href={one!.href} className="underline underline-offset-4 hover:text-foreground">
            See what we tried
          </Link>
        </p>
      )}
    </Need>
  );
}

/**
 * The answer to what a goal without a test left us asking, on the goal's own page, and the test generated again
 * with it. Or the goal let go. `waits` is when tests are being generated for the app already: this one starts
 * when they're done.
 */
export function RetryGoal({ appId, goal, retries, placeholder, waits }: { appId: string; goal: string; retries: GoalRef; placeholder: string; waits?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const hasKey = looksLikeKey(answer);
  const ready = answer.trim().length > 0 && !hasKey;

  const act = (run: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      const r = await run();
      if (r?.error) return setError(r.error);
      router.push(`/apps/${appId}`);
    });
  const retry = () => act(() => makeTestAction(appId, withAnswer(goal, answer), retries));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) retry();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && ready) retry();
      }}
    >
      <Textarea aria-label="Your answer" rows={3} maxLength={300} disabled={pending} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={placeholder} className="min-h-20 resize-none bg-background px-3.5 py-3" />
      {(hasKey || error) && (
        <p role="alert" className="text-sm text-bad">
          {hasKey ? KEY : error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !ready}>
          {pending ? "Starting…" : "Generate the test again"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => act(() => dismissGoalAction(appId, retries))}>
          Dismiss
        </Button>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">{waits ? "Tests are being generated for this app now, so this one starts when they're done. " : ""}Takes a few minutes. You can watch it on the app&apos;s page.</p>
    </form>
  );
}
