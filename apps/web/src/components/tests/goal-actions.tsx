"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissGoalAction, makeTestAction, type GoalRef } from "@/actions/tests";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { looksLikeKey } from "@/lib/secrets";

/** Takes a goal without a test off the app's list, from the list itself. */
export function DismissGoal({ appId, goal }: { appId: string; goal: GoalRef }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" variant="ghost" size="icon-sm" aria-label="Dismiss" title="Dismiss" disabled={pending} onClick={() => start(() => dismissGoalAction(appId, goal))} className="relative z-10 -my-1 shrink-0 text-muted-foreground">
      <X aria-hidden="true" />
    </Button>
  );
}

/**
 * The answer to what a goal without a test left us asking, and the goal made again with it. Or the goal let go.
 * `waits` is when tests are being made for the app already: this one starts when they're done.
 */
export function RetryGoal({ appId, goal, retries, placeholder, waits }: { appId: string; goal: string; retries: GoalRef; placeholder: string; waits?: boolean }) {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const router = useRouter();
  const hasKey = looksLikeKey(answer);

  const act = (run: () => Promise<{ error?: string } | void>) =>
    start(async () => {
      const r = await run();
      if (r?.error) return setError(r.error);
      router.push(`/apps/${appId}`);
    });
  const retry = () => act(() => makeTestAction(appId, answer.trim() ? `${goal.trim().replace(/[.\s]+$/, "")}. Good to know: ${answer.trim()}` : goal, retries));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!hasKey) retry();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !hasKey) retry();
      }}
    >
      <Textarea aria-label="Your answer" rows={3} maxLength={300} disabled={pending} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={placeholder} className="min-h-20 resize-none bg-background px-3.5 py-3" />
      {(hasKey || error) && (
        <p role="alert" className="text-sm text-bad">
          {hasKey ? "That looks like a private key. This text isn't encrypted, so take it out." : error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || hasKey}>
          {pending ? "Starting…" : "Try again"}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={() => act(() => dismissGoalAction(appId, retries))}>
          Dismiss the goal
        </Button>
      </div>
      <p className="text-xs text-pretty text-muted-foreground">
        {waits ? "Tests are being made for this app now, so this one starts when they're done. " : ""}We make the test again with your answer. It takes a few minutes, and you can watch it on the app&apos;s page.
      </p>
    </form>
  );
}
