"use client";

import { KNOWN_CHAINS, type ChainInfo, type ChainMode, type WalletProfileId } from "@dappdrill/core";
import { ChevronRight } from "lucide-react";
import { useActionState, useState } from "react";
import { createAppAction } from "@/actions/apps";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toggleVariants } from "@/components/ui/toggle";
import type { ActionResult } from "@/lib/action-result";

const WALLETS: { id: WalletProfileId; name: string }[] = [
  { id: "metamask", name: "MetaMask" },
  { id: "rabby", name: "Rabby" },
  { id: "coinbase", name: "Coinbase Wallet" },
];
const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337);
const CHIP = cx(
  toggleVariants({ variant: "outline" }),
  "relative cursor-pointer px-3 select-none has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
);
const defaultMode = (chain: ChainInfo): ChainMode => (chain.forkable ? "fork" : "live");
const modeCanChoose = (chain: ChainInfo) => chain.testnet && chain.forkable;

export function NewAppForm() {
  const [state, act, pending] = useActionState<ActionResult, FormData>(createAppAction, undefined);
  const [note, setNote] = useState(false);
  const [customized, setCustomized] = useState(false);
  const [hints, setHints] = useState("");
  const [selectedChains, setSelectedChains] = useState<number[]>([]);
  const [modes, setModes] = useState<Record<number, ChainMode>>({});
  const selected = CHAINS.filter((chain) => selectedChains.includes(chain.id));
  const needsLiveKey = selected.some((chain) => (modes[chain.id] ?? defaultMode(chain)) === "live");

  return (
    <form action={act} className="flex flex-col gap-3" aria-busy={pending}>
      <input type="hidden" name="customized" value={customized ? "1" : ""} readOnly />
      <div className="flex flex-col gap-2">
        <label htmlFor="url" className="text-sm font-medium">
          App URL
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="url" name="url" required autoFocus autoComplete="url" inputMode="url" spellCheck={false} placeholder="https://app.example.com" className="h-11 text-base md:text-base sm:flex-1" />
          <Button type="submit" size="lg" className="h-11 px-8" disabled={pending}>
            {pending ? "Opening app…" : "Generate tests"}
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-fit -ml-2 gap-1.5 px-2 text-muted-foreground"
          aria-expanded={note}
          aria-controls="customize-exploration"
          onClick={() => {
            setCustomized(true);
            setNote((open) => !open);
          }}
        >
          <ChevronRight className={`size-4 transition-transform ${note ? "rotate-90" : ""}`} />
          Customize exploration
          <span className="text-xs">Optional</span>
        </Button>
        <div id="customize-exploration" className={note ? "flex flex-col gap-5 rounded-lg border bg-muted/30 p-4" : "hidden"}>
          <div className="flex flex-col gap-2">
            <label htmlFor="wallet" className="text-sm font-medium">
              Primary wallet
            </label>
            <NativeSelect id="wallet" name="wallet" defaultValue="metamask">
              {WALLETS.map((wallet) => (
                <NativeSelectOption key={wallet.id} value={wallet.id}>
                  {wallet.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground">The wallet identity DappDrill uses first when connecting. Other wallets can be tested later.</p>
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">Chains</span>
              <p className="text-sm text-muted-foreground">Leave all off to detect what the app uses. Mainnets always run on local forks.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CHAINS.map((chain) => (
                <label key={chain.id} className={CHIP}>
                  <input
                    type="checkbox"
                    name="chain"
                    value={chain.id}
                    checked={selectedChains.includes(chain.id)}
                    onChange={() => setSelectedChains((ids) => (ids.includes(chain.id) ? ids.filter((id) => id !== chain.id) : [...ids, chain.id]))}
                    className="sr-only"
                  />
                  {chain.name}
                </label>
              ))}
            </div>
            {selected.length > 0 && (
              <div className="flex flex-col gap-2">
                {selected.map((chain) => {
                  const mode = modes[chain.id] ?? defaultMode(chain);
                  const isLive = mode === "live";
                  const canChoose = modeCanChoose(chain);
                  return (
                    <div key={chain.id} className="flex flex-col gap-3 rounded-md border bg-background p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">{chain.name}</p>
                          <p className="text-xs text-muted-foreground">Chain {chain.id}</p>
                        </div>
                        {canChoose ? (
                          <NativeSelect
                            aria-label={`How to run ${chain.name}`}
                            name={`chainMode-${chain.id}`}
                            value={mode}
                            onChange={(event) => setModes((current) => ({ ...current, [chain.id]: event.target.value as ChainMode }))}
                          >
                            <NativeSelectOption value="fork">Local fork</NativeSelectOption>
                            <NativeSelectOption value="live">Testnet</NativeSelectOption>
                          </NativeSelect>
                        ) : (
                          <>
                            <input type="hidden" name={`chainMode-${chain.id}`} value={mode} readOnly />
                            <span className="text-sm text-muted-foreground">{chain.forkable ? "Local fork" : "Testnet"}</span>
                          </>
                        )}
                      </div>
                      {isLive && (
                        <div className="flex flex-col gap-1">
                          <label htmlFor={`chainFunding-${chain.id}`} className="text-sm font-medium">
                            How to get funds on {chain.name}
                          </label>
                          <Input
                            id={`chainFunding-${chain.id}`}
                            name={`chainFunding-${chain.id}`}
                            placeholder={`e.g. Use the ${chain.name} faucet, or mint test tokens at 0x…`}
                            spellCheck={false}
                            className="bg-background"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className={needsLiveKey ? "flex flex-col gap-2" : "hidden"}>
            <label htmlFor="liveKey" className="text-sm font-medium">
              Funded testnet private key
            </label>
            <Input
              id="liveKey"
              name="liveKey"
              type="password"
              required={needsLiveKey}
              disabled={!needsLiveKey}
              autoComplete="off"
              spellCheck={false}
              className="bg-background font-mono"
              placeholder="0x…"
            />
            <p className="text-sm text-muted-foreground">Use a dedicated key with test funds only, never mainnet funds. Saved encrypted and never shown again.</p>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="hints" className="text-sm font-medium">
                General context
              </label>
              <p id="hints-description" className="text-sm text-muted-foreground">What the app does, where to start, or what the explorer should avoid.</p>
            </div>
            <Textarea
              id="hints"
              name="hints"
              rows={3}
              maxLength={2000}
              value={hints}
              onChange={(event) => setHints(event.target.value)}
              aria-describedby="hints-description"
              placeholder="For example: this is a perpetuals exchange. Start on the Markets page, use small sizes, and avoid the referral flow."
              className="bg-background"
            />
          </div>
        </div>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
