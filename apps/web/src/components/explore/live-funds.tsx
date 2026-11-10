"use client";

import type { LiveFundsNeed } from "@dappdrill/core";
import { useActionState, useState } from "react";
import { liveFundsAction } from "@/actions/apps";
import { FundsField, type FundsWay } from "@/components/funds-field";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * The pass stopped at a chain that can't be forked, where tests run for real and need an account
 * with test funds. The owner gives one of two things here: how to get them, or a key that has them.
 */
export function LiveFunds({ appId, need }: { appId: string; need: LiveFundsNeed }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(liveFundsAction, undefined);
  const [way, setWay] = useState<FundsWay>("funding");
  const [key, setKey] = useState("");
  const [funding, setFunding] = useState("");
  const ready = Boolean(way === "key" ? key.trim() : funding.trim());
  return (
    <section className="flex flex-col gap-5 rounded-xl border bg-card p-6 shadow-xs">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-semibold">{need.name} can&apos;t be forked</h2>
        <p className="max-w-prose text-sm leading-relaxed text-pretty text-muted-foreground">
          Tests run on it for real, so they need an account with test funds there. Tell us how a new account gets them, or give us a private key that has them, and we&apos;ll explore from there.
        </p>
      </div>
      <form action={act} className="flex max-w-xl flex-col gap-5">
        <input type="hidden" name="appId" value={appId} readOnly />
        <FundsField way={way} onWay={setWay} funding={funding} onFunding={setFunding} liveKey={key} onKey={setKey} className="gap-2" />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={!ready || pending}>
            {pending ? "Starting…" : "Explore again"}
          </Button>
          {state?.error && <p className="text-sm text-bad">{state.error}</p>}
        </div>
      </form>
    </section>
  );
}
