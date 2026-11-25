"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { FundRow } from "@/lib/funds";

/** What a test's new account starts with: null is what the app sends every new account, no rows is nothing. */
export type Starts = FundRow[] | null;

/** What the forms need to offer the choice: the chains a row can be on, and what the app sends every new account, in words. */
export interface StartChoices {
  chains: { id: number; name: string }[];
  sends: string;
}

/**
 * What the account of one test starts with, on an app whose tests each get a new account: what every new
 * account is sent, nothing, or funds of its own. What is left on it after the test goes back to the key that paid.
 */
export function StartsWith({ id, value, onChange, choices, disabled }: { id: string; value: Starts; onChange: (value: Starts) => void; choices: StartChoices; disabled?: boolean }) {
  const mode = value === null ? "app" : value.length === 0 ? "nothing" : "own";
  const blank = (): FundRow => ({ chainId: choices.chains[0]?.id, token: "", amount: "" });
  const set = (i: number, patch: Partial<FundRow>) => onChange(value!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const options = (row: FundRow) => (row.chainId === undefined || choices.chains.some((c) => c.id === row.chainId) ? choices.chains : [...choices.chains, { id: row.chainId, name: `Chain ${row.chainId}` }]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>The account starts with</Label>
      <div className="[&>div]:w-full">
        <NativeSelect id={id} value={mode} disabled={disabled} onChange={(e) => onChange(e.target.value === "app" ? null : e.target.value === "nothing" ? [] : [blank()])} className="bg-background">
          <NativeSelectOption value="app">What every new account is sent: {choices.sends}</NativeSelectOption>
          <NativeSelectOption value="nothing">Nothing</NativeSelectOption>
          <NativeSelectOption value="own">Funds of its own</NativeSelectOption>
        </NativeSelect>
      </div>
      {mode === "own" && (
        <>
          {value!.map((row, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,7rem)_auto]">
              <div className="[&>div]:w-full">
                <NativeSelect aria-label={`Chain, row ${i + 1}`} value={row.chainId ?? ""} disabled={disabled} onChange={(e) => set(i, { chainId: e.target.value ? Number(e.target.value) : undefined })} className="bg-background">
                  <NativeSelectOption value="">Chain</NativeSelectOption>
                  {options(row).map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Remove row ${i + 1}`} onClick={() => onChange(value!.filter((_, j) => j !== i))} className="text-muted-foreground sm:order-last">
                <X aria-hidden="true" />
              </Button>
              <Input
                aria-label={`Token address, row ${i + 1}`}
                autoComplete="off"
                spellCheck={false}
                placeholder="Token address, or empty for the chain's coin"
                value={row.token}
                disabled={disabled}
                onChange={(e) => set(i, { token: e.target.value })}
                className="col-span-2 bg-background font-mono text-sm sm:col-span-1"
              />
              <Input
                aria-label={`Amount, row ${i + 1}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Amount"
                value={row.amount}
                disabled={disabled}
                onChange={(e) => set(i, { amount: e.target.value })}
                className="col-span-2 bg-background tabular-nums sm:col-span-1"
              />
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange([...value!, blank()])} className="-ml-2 self-start text-muted-foreground">
            <Plus aria-hidden="true" />
            Send something else
          </Button>
        </>
      )}
      <p className="text-xs text-pretty text-muted-foreground">
        {mode === "own"
          ? "Paid from the app's key before the test. Amounts are in whole units, like 0.05 or 100. What the test leaves on the account is sent back to that key."
          : mode === "nothing"
            ? "For a test of what the app does when the user holds nothing."
            : "Set in the app's settings. What the test leaves on the account is sent back to the key that paid."}
      </p>
    </div>
  );
}
