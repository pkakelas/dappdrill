"use client";

import { chainName, shortAddress } from "@dappdrill/core";
import { KeyRound, Plus, UserRound, UserRoundPlus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { toggleVariants } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

/** A checkbox or a radio drawn as an outline toggle; a real input, so the form posts it and sees the change. */
export const CHIP = cn(
  toggleVariants({ variant: "outline" }),
  "relative cursor-pointer px-3 select-none has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
);

export type AccountChoice = "new" | "kept";

/** Something each new account is sent: the chain's own coin when there is no token. */
export interface FundDefault {
  chainId: number;
  token?: string;
  amount: string;
}

const CHOICES = [
  { id: "new", label: "New account for every test", icon: UserRoundPlus },
  { id: "kept", label: "Kept account", icon: UserRound },
] as const;

const ABOUT: Record<AccountChoice, string> = {
  new: "Each test starts as a user the app hasn't seen, so no test depends on what another left behind.",
  kept: "Every test uses the same account, put back before each test. For an app where a new user can't be had every time.",
};

const KEY_LABEL: Record<AccountChoice, string> = { new: "Private key that pays each new account", kept: "Private key of the account" };
const NO_KEY: Record<AccountChoice, string> = {
  new: "Optional. Without one, a new account starts empty and gets its funds inside the app.",
  kept: "Optional. Without one, the organization's test wallets are the account.",
};

interface Row {
  key: number;
  chainId?: number;
  token: string;
  amount: string;
}

/**
 * Which account the tests use, posted as `account`: a new one for every test, or one that is kept. The
 * private key (`fundedKey`) pays each new account, or is the kept account. With new accounts, the rows say
 * what each is sent first, posted as `fundChain`, `fundToken` and `fundAmount`, one of each a row.
 *
 * `chains` are the ones a row can be on and `chain` the one a new row starts on. `saved` is the address
 * of the key already stored, and `cleared` changes when the form was saved, which empties the key box.
 */
export function AccountField({
  defaults,
  chains,
  chain,
  saved,
  cleared,
  onEdit,
  fieldClassName,
}: {
  defaults?: { account: AccountChoice; fund: FundDefault[] };
  chains: { id: number; name: string }[];
  chain?: number;
  saved?: string | null;
  cleared?: number;
  /** Rows were added or taken out: a change the form hears nothing of. */
  onEdit?: () => void;
  fieldClassName?: string;
}) {
  const [account, setAccount] = useState<AccountChoice>(defaults?.account ?? "new");
  const [key, setKey] = useState("");
  const [remove, setRemove] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => (defaults?.fund ?? []).map((f, i) => ({ key: i, chainId: f.chainId, token: f.token ?? "", amount: f.amount })));
  const nextKey = useRef(rows.length);
  useEffect(() => {
    setKey("");
    setRemove(false);
  }, [cleared]);

  const change = (row: Row, to: Partial<Row>) => setRows((all) => all.map((r) => (r.key === row.key ? { ...r, ...to } : r)));
  const edit = (next: (all: Row[]) => Row[]) => {
    setRows(next);
    onEdit?.();
  };
  // A chain a saved row is on stays in its list after the app stopped using it.
  const options = (row: Row) => (row.chainId === undefined || chains.some((c) => c.id === row.chainId) ? chains : [...chains, { id: row.chainId, name: chainName(row.chainId) }]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div role="radiogroup" aria-label="Account" className="flex flex-wrap gap-2">
          {CHOICES.map(({ id, label, icon: Icon }) => (
            <label key={id} className={CHIP}>
              <input type="radio" name="account" value={id} checked={account === id} onChange={() => setAccount(id)} className="sr-only" />
              <Icon className="size-[18px]" aria-hidden="true" />
              {label}
            </label>
          ))}
        </div>
        <p className="text-sm text-pretty text-muted-foreground">{ABOUT[account]}</p>
      </div>

      <Field className="gap-2">
        <FieldLabel htmlFor="fundedKey">{KEY_LABEL[account]}</FieldLabel>
        <InputGroup className={cn("h-11", fieldClassName)}>
          <InputGroupAddon>
            <KeyRound />
          </InputGroupAddon>
          <InputGroupInput id="fundedKey" name="fundedKey" type="password" autoComplete="off" spellCheck={false} placeholder="0x…" value={key} onChange={(event) => setKey(event.target.value)} className="font-mono" />
        </InputGroup>
        <FieldDescription>{saved ? `Saved for ${shortAddress(saved)}. Paste a new one to replace it.` : `${NO_KEY[account]} Saved encrypted and never shown again.`}</FieldDescription>
        {saved && (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <Checkbox name="removeKey" value="1" checked={remove} onCheckedChange={(next) => setRemove(next === true)} />
            Remove the saved key
          </label>
        )}
      </Field>

      {account === "new" && (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-snug font-medium">Sent to each new account</p>
          {rows.map((row, i) => (
            <div key={row.key} className="grid animate-in grid-cols-[minmax(0,1fr)_auto] gap-2 duration-200 fade-in-0 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,7rem)_auto]">
              <div className="[&>div]:w-full">
                <NativeSelect name="fundChain" aria-label={`Chain of what is sent, row ${i + 1}`} value={row.chainId ?? ""} onChange={(event) => change(row, { chainId: event.target.value ? Number(event.target.value) : undefined })} className={cn("h-11", fieldClassName)}>
                  <NativeSelectOption value="">Chain</NativeSelectOption>
                  {options(row).map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label={`Remove row ${i + 1}`} onClick={() => edit((all) => all.filter((r) => r.key !== row.key))} className="size-11 text-muted-foreground sm:order-last">
                <X />
              </Button>
              <Input
                name="fundToken"
                aria-label={`Token address, row ${i + 1}`}
                autoComplete="off"
                spellCheck={false}
                placeholder="Token address, or empty for the chain's coin"
                value={row.token}
                onChange={(event) => change(row, { token: event.target.value })}
                className={cn("col-span-2 h-11 font-mono text-sm sm:col-span-1", fieldClassName)}
              />
              <Input
                name="fundAmount"
                aria-label={`Amount, row ${i + 1}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="Amount"
                value={row.amount}
                onChange={(event) => change(row, { amount: event.target.value })}
                className={cn("col-span-2 h-11 tabular-nums sm:col-span-1", fieldClassName)}
              />
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => edit((all) => [...all, { key: nextKey.current++, chainId: chain, token: "", amount: "" }])} className="-ml-2 self-start text-muted-foreground">
            <Plus />
            {rows.length ? "Send something else" : "Send it funds first"}
          </Button>
          {rows.length > 0 && <FieldDescription>Paid from the key above, before the setup. Amounts are in whole units, like 0.05 or 100.</FieldDescription>}
        </div>
      )}
    </div>
  );
}
