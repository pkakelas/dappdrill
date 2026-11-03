"use client";

import { KNOWN_CHAINS, type ParamDef } from "@dappdrill/core";
import { useActionState } from "react";
import { addVariationAction, type ActionResult } from "@/actions/flows";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Feedback } from "./forms";

/** "Add a variation" form, inline under the Variations table. */
export function AddVariation({ flowId, params }: { flowId: string; params: ParamDef[] }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(addVariationAction, undefined);
  return (
    <details className="group">
      <summary className="w-fit text-sm font-medium underline-offset-4 hover:underline">Add a variation</summary>
      <form action={action} className="mt-4 flex flex-col gap-4 rounded-lg border p-4">
        <input type="hidden" name="flowId" value={flowId} />
        <div className="grid gap-2">
          <Label htmlFor="var-name">Name</Label>
          <Input id="var-name" name="name" required maxLength={80} placeholder="Dust amount" />
        </div>
        {params.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {params.map((p) => (
              <div key={p.name} className="grid gap-2">
                <Label htmlFor={`var-${p.name}`} className="font-mono">
                  {p.name}
                </Label>
                <Input id={`var-${p.name}`} name={`input:${p.name}`} placeholder={p.default} />
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <div className="grid gap-2">
            <Label htmlFor="var-wallet">Wallet</Label>
            <NativeSelect id="var-wallet" name="wallet" defaultValue="">
              <NativeSelectOption value="">Same as the flow</NativeSelectOption>
              <NativeSelectOption value="metamask">MetaMask-style</NativeSelectOption>
              <NativeSelectOption value="rabby">Rabby</NativeSelectOption>
              <NativeSelectOption value="coinbase">Coinbase Wallet</NativeSelectOption>
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="var-chain">Chain</Label>
            <NativeSelect id="var-chain" name="chainId" defaultValue="">
              <NativeSelectOption value="">Same as the flow</NativeSelectOption>
              {KNOWN_CHAINS.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="var-account">Account</Label>
            <NativeSelect id="var-account" name="account" defaultValue="">
              <NativeSelectOption value="">Test account A</NativeSelectOption>
              <NativeSelectOption value="B">Test account B</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add variation"}
          </Button>
          <Feedback state={state} />
        </div>
      </form>
    </details>
  );
}
