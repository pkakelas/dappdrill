"use client";

import { Check, Link2 } from "lucide-react";
import { useEffect, useState, type Ref } from "react";
import { checkRpcAction } from "@/actions/apps";
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

/** Where the tests will run, said under the chain choice. */
export function chainNote({ name, other }: { name?: string; other: boolean }) {
  if (!name) return other ? "Paste the RPC your app uses and we'll work out the chain." : "We'll see which chain your app connects to.";
  return `Tests run on ${name}. What a test signs is sent there.`;
}
