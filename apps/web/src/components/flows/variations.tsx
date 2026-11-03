"use client";

import { KNOWN_CHAINS, type ParamDef } from "@dappdrill/core";
import { useActionState } from "react";
import { addVariationAction, type ActionResult } from "@/actions/flows";
import { Disclosure, Field, FormMessage, SubmitButton } from "@/components/ui";

/** "Add a variation" form, inline under the Variations table. */
export function AddVariation({ flowId, params }: { flowId: string; params: ParamDef[] }) {
  const [state, action] = useActionState<ActionResult, FormData>(addVariationAction, undefined);
  return (
    <Disclosure summary="Add a variation">
      <form action={action} className="flex flex-col gap-4 p-5">
        <input type="hidden" name="flowId" value={flowId} />
        <Field label="Name">
          <input name="name" required maxLength={80} className="field" placeholder="Dust amount" />
        </Field>
        {params.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {params.map((p) => (
              <Field key={p.name} label={<span className="param normal-case">{p.name}</span>} className="flex-[1_1_180px]">
                <input name={`input:${p.name}`} className="field" placeholder={p.default} />
              </Field>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <Field label="Wallet">
            <select name="wallet" className="field" defaultValue="">
              <option value="">Same as the flow</option>
              <option value="metamask">MetaMask-style</option>
              <option value="rabby">Rabby</option>
              <option value="coinbase">Coinbase Wallet</option>
            </select>
          </Field>
          <Field label="Chain">
            <select name="chainId" className="field" defaultValue="">
              <option value="">Same as the flow</option>
              {KNOWN_CHAINS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Account">
            <select name="account" className="field" defaultValue="">
              <option value="">Test account A</option>
              <option value="B">Test account B</option>
            </select>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <SubmitButton className="btn-sm btn-primary" pendingText="Adding…">
            Add variation
          </SubmitButton>
          <FormMessage state={state} />
        </div>
      </form>
    </Disclosure>
  );
}
