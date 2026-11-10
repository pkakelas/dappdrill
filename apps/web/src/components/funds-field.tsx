"use client";

import { Coins, KeyRound } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type FundsWay = "funding" | "key";

export interface FundsFieldProps {
  way: FundsWay;
  onWay: (way: FundsWay) => void;
  funding: string;
  onFunding: (value: string) => void;
  liveKey: string;
  onKey: (value: string) => void;
  /** The account of a key already saved, when one is. */
  saved?: string | null;
  required?: boolean;
  className?: string;
}

/**
 * How tests get funds on a chain that can't be forked, where they run for real: the owner says how
 * a new account gets test funds, or pastes a key that has them. One way at a time, so only the
 * chosen input is posted (`funding` or `liveKey`).
 */
/** Says a chain can't be forked, above the field that asks how its tests get funds. */
export function UnforkableNote({ chain }: { chain: string }) {
  return (
    <Alert role="note" className="border-transparent bg-live-soft">
      <Coins className="text-live" aria-hidden="true" />
      <AlertTitle className="text-live-ink">{chain} can&apos;t be forked</AlertTitle>
      <AlertDescription className="text-foreground/80">
        <p className="text-pretty">Tests run on it for real, so they need an account with test funds there.</p>
      </AlertDescription>
    </Alert>
  );
}

export function FundsField({ way, onWay, funding, onFunding, liveKey, onKey, saved, required, className }: FundsFieldProps) {
  const id = way === "key" ? "liveKey" : "funding";
  return (
    <Field className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FieldLabel htmlFor={id}>{way === "key" ? "Private key with test tokens" : "How do we get test funds?"}</FieldLabel>
        <ToggleGroup type="single" size="sm" variant="outline" aria-label="How tests get funds" value={way} onValueChange={(next) => next && onWay(next as FundsWay)}>
          <ToggleGroupItem value="funding">Tell us how</ToggleGroupItem>
          <ToggleGroupItem value="key">Private key</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {way === "key" ? (
        <InputGroup className="h-11">
          <InputGroupAddon>
            <KeyRound />
          </InputGroupAddon>
          <InputGroupInput
            id="liveKey"
            name="liveKey"
            type="password"
            required={required && !saved}
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
          required={required}
          rows={2}
          maxLength={1000}
          placeholder="e.g. The Faucet page mints 1,000 test USDC. Or: there's a mint function on the token."
          value={funding}
          onChange={(event) => onFunding(event.target.value)}
          className="min-h-20 resize-none"
        />
      )}
      <FieldDescription>
        {way === "key"
          ? saved
            ? `Saved for ${saved}. Paste a new one to replace it.`
            : "Every test runs from this account. Use one that only holds test funds; it's saved encrypted."
          : "Each run starts with a new account that gets test funds this way."}
      </FieldDescription>
    </Field>
  );
}
