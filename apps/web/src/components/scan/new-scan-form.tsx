"use client";

import { EDGE_CASES, KNOWN_CHAINS, MAINNET_CHAIN_IDS, type ChainConfig, type EdgeCaseId, type WalletProfileId } from "@dappdrill/core";
import { useActionState, useState } from "react";
import { startScanAction, type FormState } from "@/actions/scan";
import { ArrowIcon, Checkbox, ChevronIcon, Chip, Field, FormMessage, Notice, SubmitButton } from "@/components/ui";

const WALLETS: { id: WalletProfileId; label: string }[] = [
  { id: "metamask", label: "MetaMask-style" },
  { id: "rabby", label: "Rabby" },
  { id: "coinbase", label: "Coinbase Wallet" },
];

export interface NewScanDefaults {
  appId?: string;
  url: string;
  chains: ChainConfig[];
  wallets: WalletProfileId[];
  edgeCases: EdgeCaseId[];
  hints: string;
  allowMainnetLive: boolean;
  liveKeyAddress: string | null;
}

export function NewScanForm({ defaults, usage }: { defaults: NewScanDefaults; usage: string | null }) {
  const [state, action] = useActionState<FormState, FormData>(startScanAction, undefined);
  const known = new Set(KNOWN_CHAINS.map((c) => c.id));
  const custom = defaults.chains.find((c) => !known.has(c.id));
  const [chainMode, setChainMode] = useState<"auto" | "pick">(defaults.chains.length ? "pick" : "auto");
  const [picked, setPicked] = useState<Set<number>>(new Set(defaults.chains.map((c) => c.id)));
  const [customLive, setCustomLive] = useState(custom?.mode === "live");
  const [customId, setCustomId] = useState(custom ? String(custom.id) : "");
  const [allowMainnet, setAllowMainnet] = useState(defaults.allowMainnetLive);

  const liveChains = chainMode === "pick" ? KNOWN_CHAINS.filter((c) => picked.has(c.id) && !c.forkable) : [];
  const needsKey = liveChains.length > 0 || (chainMode === "pick" && customLive && customId !== "");
  const customIsMainnet = customId !== "" && MAINNET_CHAIN_IDS.has(Number(customId));

  return (
    <form action={action} className="card flex flex-col gap-7 p-5 sm:p-7">
      {defaults.appId && <input type="hidden" name="appId" value={defaults.appId} />}
      <div className="flex flex-col gap-2">
        <label htmlFor="url" className="label">
          dApp URL
        </label>
        <div className="flex flex-wrap gap-2.5">
          <input
            id="url"
            name="url"
            type="text"
            inputMode="url"
            autoComplete="url"
            required
            placeholder="https://app.example.xyz"
            defaultValue={defaults.url}
            aria-invalid={state?.error ? true : undefined}
            className="field field-lg flex-[1_1_320px] font-mono"
          />
          <SubmitButton className="btn-primary btn-lg" pendingText="Starting…">
            Start scan
            <ArrowIcon />
          </SubmitButton>
        </div>
        <FormMessage state={state} />
      </div>

      <details className="group/c" open={Boolean(defaults.appId && (defaults.chains.length || defaults.hints))}>
        <summary className="btn-link w-fit">
          Customize
          <span className="font-normal text-muted">chains, wallets, edge cases</span>
          <ChevronIcon className="transition-transform group-open/c:rotate-180" />
        </summary>

        <div className="mt-6 flex flex-col gap-7">
          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="label mb-2.5 p-0">Chains</legend>
            <input type="hidden" name="chainMode" value={chainMode} />
            <div className="seg w-fit" role="group" aria-label="How to choose chains">
              <button type="button" aria-pressed={chainMode === "auto"} onClick={() => setChainMode("auto")}>
                Detect from the site
              </button>
              <button type="button" aria-pressed={chainMode === "pick"} onClick={() => setChainMode("pick")}>
                Pick chains
              </button>
            </div>
            {chainMode === "auto" ? (
              <p className="hint m-0">We watch the site&apos;s RPC traffic and fork every chain it talks to.</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {KNOWN_CHAINS.map((c) => (
                    <Chip
                      key={c.id}
                      name="chains"
                      value={c.id}
                      checked={picked.has(c.id)}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(c.id);
                        else next.delete(c.id);
                        setPicked(next);
                      }}
                    >
                      {c.name}
                      {!c.forkable && <span className="text-xs opacity-70">live</span>}
                    </Chip>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-2.5">
                  <Field label="Custom chain ID" className="w-36">
                    <input name="customChainId" inputMode="numeric" className="field font-mono" value={customId} onChange={(e) => setCustomId(e.target.value.replace(/\D/g, ""))} />
                  </Field>
                  <Field label="RPC URL" className="flex-[1_1_260px]">
                    <input name="customRpc" type="url" placeholder="https://rpc.example.org" defaultValue={custom?.rpcUrl} className="field font-mono" />
                  </Field>
                  <Checkbox name="customLive" checked={customLive} onChange={(e) => setCustomLive(e.target.checked)} label="Can't be forked" className="mb-3" />
                </div>
                {customIsMainnet && <p className="hint m-0">Chain {customId} is a mainnet.</p>}
              </>
            )}
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="label mb-2.5 p-0">Wallets to test with</legend>
            <div className="flex flex-wrap gap-2">
              {WALLETS.map((w) => (
                <Chip key={w.id} name="wallets" value={w.id} defaultChecked={defaults.wallets.includes(w.id)}>
                  {w.label}
                </Chip>
              ))}
            </div>
            <p className="hint m-0">Embedded wallets (Privy, Dynamic, Web3Auth) sign in with your team&apos;s test inbox. Login codes are read for you.</p>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="label mb-3 p-0">Wallet edge cases to try</legend>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {EDGE_CASES.map((e) => (
                <Checkbox key={e.id} name="edgeCases" value={e.id} defaultChecked={defaults.edgeCases.includes(e.id)} label={e.label} description={e.description} className="min-h-10 py-2" />
              ))}
            </div>
          </fieldset>

          <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
            <legend className="label mb-2.5 p-0">Funded test key</legend>
            <p className="hint m-0">
              Only for chains that can&apos;t be forked. Live mode: real testnet funds are used. The key is stored encrypted; afterwards we only show its address.
            </p>
            {defaults.liveKeyAddress && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>
                  Stored key for <span className="font-mono">{defaults.liveKeyAddress}</span>
                </span>
                <Checkbox name="removeLiveKey" label="Remove it" />
              </div>
            )}
            <input
              name="liveKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={defaults.liveKeyAddress ? "Replace with another key (0x…)" : "0x… private key of a funded testnet account"}
              className="field font-mono"
              aria-label="Funded test private key"
              required={needsKey && !defaults.liveKeyAddress}
            />
            <Checkbox
              name="allowMainnetLive"
              checked={allowMainnet}
              onChange={(e) => setAllowMainnet(e.target.checked)}
              label="Allow mainnet in live mode"
              description="Off by default. Live mode on a mainnet spends real money."
            />
            {allowMainnet && (
              <Notice tone="bad" role="note">
                Transactions on a mainnet in live mode are real and can&apos;t be undone. Use a key that holds only what you&apos;re willing to lose.
              </Notice>
            )}
          </fieldset>

          <Field label="Notes for the explorer" hint="Where to look, what to skip. The explorer reads this before it starts.">
            <textarea
              name="hints"
              rows={3}
              maxLength={2000}
              defaultValue={defaults.hints}
              placeholder="There's a referral flow at /invite. Skip the bridge page."
              className="field"
            />
          </Field>
        </div>
      </details>

      <div className="meta flex flex-wrap justify-between gap-2 border-t border-divide pt-5">
        <span>Usually takes 10–15 minutes. You can close this tab.</span>
        {usage && <span>{usage}</span>}
      </div>
    </form>
  );
}
