"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useId, useState, type Ref } from "react";
import { checkRpcAction } from "@/actions/apps";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";

export type RpcCheck = { status: "idle" | "checking" } | { status: "ok"; chainId: number } | { status: "bad"; error: string };

/** Asks the server which chain the URL belongs to, once typing pauses. */
export function useRpcCheck(url: string, enabled: boolean): RpcCheck {
  const [check, setCheck] = useState<RpcCheck>({ status: "idle" });
  useEffect(() => {
    if (!enabled || !url.trim()) {
      setCheck({ status: "idle" });
      return;
    }
    let stale = false;
    setCheck({ status: "checking" });
    const timer = setTimeout(async () => {
      const result = await checkRpcAction(url).catch(() => ({ chainId: undefined, error: "We couldn't check that URL." }));
      if (stale) return;
      setCheck(result.chainId === undefined ? { status: "bad", error: result.error ?? "" } : { status: "ok", chainId: result.chainId });
    }, 500);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [url, enabled]);
  return check;
}

type RpcFieldProps = { ref?: Ref<HTMLInputElement>; id?: string; autoFocus?: boolean; value: string; onChange: (value: string) => void; check: RpcCheck; chain?: string; invalid: boolean; className?: string };

/** The RPC URL of a chain we don't list, naming the chain once it answers. */
export function RpcField({ ref, id, autoFocus, value, onChange, check, chain, invalid, className }: RpcFieldProps) {
  return (
    <InputGroup className={className}>
      <InputGroupAddon>
        <Link2 />
      </InputGroupAddon>
      <InputGroupInput
        ref={ref}
        id={id}
        autoFocus={autoFocus}
        name="rpcUrl"
        aria-label="RPC URL"
        aria-invalid={invalid}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder="https://rpc.example.org"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {check.status === "checking" && (
        <InputGroupAddon align="inline-end">
          <Spinner />
        </InputGroupAddon>
      )}
      {check.status === "ok" && (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="animate-in whitespace-nowrap duration-200 fade-in-0">
            <Check />
            {chain}
          </InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** Only a chain we can't place needs the user's word that it's a testnet. */
export function TestnetTick({ name, value, checked, onChange }: { name?: string; value?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <FieldLabel htmlFor={id} className="animate-in duration-200 fade-in-0 slide-in-from-top-1">
      <Field orientation="horizontal" className="p-3!">
        <Checkbox id={id} name={name} value={value} checked={checked} onCheckedChange={(next) => onChange(next === true)} />
        <FieldContent>
          <FieldTitle>This is a testnet</FieldTitle>
          <FieldDescription>Lets you add a private key below.</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

export function chainNote({ name, other, testnet, live, forkable }: { name?: string; other: boolean; testnet: boolean; live: boolean; forkable: boolean }) {
  if (!name) return other ? "Paste the RPC your app uses and we'll work out the chain." : "We'll see which chain your app connects to.";
  if (live) return "Tests run on the real testnet with your key, not a fork.";
  if (!forkable) return `${name} can't be forked, so tests run on it directly. Add a private key below to send transactions.`;
  if (testnet && other) return `Tests run on a local fork of ${name}. If it can't be forked, or you want the real testnet, add a private key below.`;
  if (testnet) return `Tests run on a local fork of ${name}. Add a private key below to use the real testnet.`;
  return `Tests run on a local fork of ${name}, so no real funds are involved.`;
}
