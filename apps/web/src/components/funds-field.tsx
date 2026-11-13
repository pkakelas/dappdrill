"use client";

import { Coins, KeyRound, Radio } from "lucide-react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type FundsWay = "key" | "funding";

export interface FundsFieldProps {
  /** The chain's name, as the form shows it. */
  chain: string;
  way: FundsWay;
  onWay: (way: FundsWay) => void;
  funding: string;
  onFunding: (value: string) => void;
  liveKey: string;
  onKey: (value: string) => void;
  className?: string;
}

/**
 * Asked as soon as the chain picked can't be forked, and it has to be answered: tests run on the real
 * network there, so the wallet needs funds. The owner pastes a key that has them, or says how to get
 * them. One way at a time, so only the chosen input is posted (`liveKey` or `funding`).
 */
export function FundsField({ chain, way, onWay, funding, onFunding, liveKey, onKey, className }: FundsFieldProps) {
  const key = way === "key";
  return (
    <div className={cn("flex flex-col gap-4 rounded-lg border border-live/25 bg-live-soft/60 p-4", className)}>
      <div className="flex items-start gap-3">
        <Radio className="mt-0.5 size-4 shrink-0 text-live" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-0.5 text-sm">
          <p className="font-medium text-live-ink">{chain} can&apos;t be forked</p>
          <p className="text-pretty text-foreground/80">So the tests have to run on the real network, and the test wallet needs funds there.</p>
        </div>
      </div>

      <Field className="gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <FieldLabel htmlFor="fundsWay">How should we fund the wallet?</FieldLabel>
          <span className="text-xs text-muted-foreground">Required</span>
        </div>
        <Select value={way} onValueChange={(next) => onWay(next as FundsWay)}>
          <SelectTrigger id="fundsWay" className="w-full bg-background data-[size=default]:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="key">
              <KeyRound className="size-[18px]" />
              With a private key that holds test funds
            </SelectItem>
            <SelectItem value="funding">
              <Coins className="size-[18px]" />
              Tell us how to get test funds
            </SelectItem>
          </SelectContent>
        </Select>

        {key ? (
          <InputGroup className="h-11 bg-background">
            <InputGroupAddon>
              <KeyRound />
            </InputGroupAddon>
            <InputGroupInput
              id="liveKey"
              name="liveKey"
              type="password"
              required
              aria-label="Private key that holds test funds"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={liveKey}
              onChange={(event) => onKey(event.target.value)}
              className="font-mono"
            />
          </InputGroup>
        ) : (
          <Textarea
            id="funding"
            name="funding"
            required
            aria-label="How to get test funds"
            rows={2}
            maxLength={1000}
            placeholder="e.g. The Faucet page has a Mint button. Or: call mint() on the test token."
            value={funding}
            onChange={(event) => onFunding(event.target.value)}
            className="min-h-20 resize-none bg-background"
          />
        )}
        <FieldDescription>
          {key ? "Every test signs with this account. Use one that only holds test funds; it's saved encrypted." : "The test wallet gets its funds this way before the tests run."}
        </FieldDescription>
      </Field>
    </div>
  );
}
