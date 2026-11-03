"use client";

import { EDGE_CASES, KNOWN_CHAINS, MAINNET_CHAIN_IDS, type ChainConfig, type EdgeCaseId, type WalletProfileId } from "@dappdrill/core";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { startScanAction, type FormState } from "@/actions/scan";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

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
  /** Names of the stored allowlist headers; their values are never sent back. */
  accessHeaderNames: string[];
}

function StartButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending ? "Starting…" : "Start scan"}
      <ArrowRight />
    </Button>
  );
}

/** A checkbox with its label (and an optional line under it). */
function Check({
  name,
  value,
  label,
  hint,
  ...state
}: {
  name: string;
  value?: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  defaultChecked?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}) {
  const id = `${name}-${value ?? "on"}`;
  return (
    <div className="flex items-start gap-2.5">
      <Checkbox id={id} name={name} value={value} className="mt-0.5" {...state} onCheckedChange={state.onCheckedChange ? (c) => state.onCheckedChange!(c === true) : undefined} />
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
        {label}
        {hint && <span className="text-muted-foreground">{hint}</span>}
      </Label>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 md:grid-cols-[200px_1fr] md:gap-8">
      <div className="flex flex-col gap-1">
        <legend className="font-medium">{title}</legend>
        {hint && <p className="text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-3">{children}</div>
    </fieldset>
  );
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
    <form action={action}>
      <Card>
        <CardContent className="flex flex-col gap-6">
          {defaults.appId && <input type="hidden" name="appId" value={defaults.appId} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="url">dApp URL</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="url"
                name="url"
                type="text"
                inputMode="url"
                autoComplete="url"
                required
                placeholder="https://app.example.xyz"
                defaultValue={defaults.url}
                className="h-10 flex-[1_1_320px] font-mono"
              />
              <StartButton />
            </div>
            {state?.error && (
              <p role="alert" className="text-destructive">
                {state.error}
              </p>
            )}
          </div>

          <details className="group/c" open={Boolean(defaults.appId && (defaults.chains.length || defaults.hints || defaults.accessHeaderNames.length))}>
            <summary className="flex w-fit items-center gap-1.5 font-medium">
              Customize
              <span className="font-normal text-muted-foreground">chains, wallets, edge cases</span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open/c:rotate-180" />
            </summary>

            <div className="mt-6 flex flex-col gap-6">
              <Section title="Chains">
                <input type="hidden" name="chainMode" value={chainMode} />
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={chainMode}
                  onValueChange={(v) => v && setChainMode(v as "auto" | "pick")}
                  aria-label="How to choose chains"
                  className="w-fit"
                >
                  <ToggleGroupItem value="auto" className="px-3">
                    Detect from the site
                  </ToggleGroupItem>
                  <ToggleGroupItem value="pick" className="px-3">
                    Pick chains
                  </ToggleGroupItem>
                </ToggleGroup>
                {chainMode === "auto" ? (
                  <p className="text-muted-foreground">We watch the site&apos;s RPC traffic and fork every chain it talks to.</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {KNOWN_CHAINS.map((c) => (
                        <Check
                          key={c.id}
                          name="chains"
                          value={String(c.id)}
                          label={
                            <span>
                              {c.name}
                              {!c.forkable && <span className="text-muted-foreground"> · live</span>}
                            </span>
                          }
                          checked={picked.has(c.id)}
                          onCheckedChange={(on) => {
                            const next = new Set(picked);
                            if (on) next.add(c.id);
                            else next.delete(c.id);
                            setPicked(next);
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="flex w-32 flex-col gap-1.5">
                        <Label htmlFor="customChainId" className="font-normal text-muted-foreground">
                          Custom chain ID
                        </Label>
                        <Input id="customChainId" name="customChainId" inputMode="numeric" className="font-mono" value={customId} onChange={(e) => setCustomId(e.target.value.replace(/\D/g, ""))} />
                      </div>
                      <div className="flex min-w-0 flex-[1_1_240px] flex-col gap-1.5">
                        <Label htmlFor="customRpc" className="font-normal text-muted-foreground">
                          RPC URL
                        </Label>
                        <Input id="customRpc" name="customRpc" type="url" placeholder="https://rpc.example.org" defaultValue={custom?.rpcUrl} className="font-mono" />
                      </div>
                      <div className="flex h-9 items-center">
                        <Check name="customLive" label="Can't be forked" checked={customLive} onCheckedChange={setCustomLive} />
                      </div>
                    </div>
                    {customIsMainnet && <p className="text-muted-foreground">Chain {customId} is a mainnet.</p>}
                  </>
                )}
              </Section>

              <Separator />

              <Section title="Wallets" hint="Embedded wallets (Privy, Dynamic, Web3Auth) sign in with your team's test inbox.">
                <div className="flex flex-wrap gap-x-6 gap-y-3">
                  {WALLETS.map((w) => (
                    <Check key={w.id} name="wallets" value={w.id} label={w.label} defaultChecked={defaults.wallets.includes(w.id)} />
                  ))}
                </div>
              </Section>

              <Separator />

              <Section title="Edge cases">
                <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {EDGE_CASES.map((e) => (
                    <Check key={e.id} name="edgeCases" value={e.id} label={e.label} hint={e.description} defaultChecked={defaults.edgeCases.includes(e.id)} />
                  ))}
                </div>
              </Section>

              <Separator />

              <Section title="Funded test key" hint="Only for chains that can't be forked. Stored encrypted; afterwards we only show its address.">
                {defaults.liveKeyAddress && (
                  <div className="flex flex-wrap items-center gap-4">
                    <span>
                      Stored key for <span className="font-mono">{defaults.liveKeyAddress}</span>
                    </span>
                    <Check name="removeLiveKey" label="Remove it" />
                  </div>
                )}
                <Input
                  name="liveKey"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={defaults.liveKeyAddress ? "Replace with another key (0x…)" : "0x… private key of a funded testnet account"}
                  className="font-mono"
                  aria-label="Funded test private key"
                  required={needsKey && !defaults.liveKeyAddress}
                />
                <Check name="allowMainnetLive" label="Allow mainnet in live mode" hint="Off by default. Live mode on a mainnet spends real money." checked={allowMainnet} onCheckedChange={setAllowMainnet} />
                {allowMainnet && (
                  <Alert className="border-bad-line bg-bad-soft text-bad-ink">
                    <AlertDescription className="text-bad-ink">
                      Transactions on a mainnet in live mode are real and can&apos;t be undone. Use a key that holds only what you&apos;re willing to lose.
                    </AlertDescription>
                  </Alert>
                )}
              </Section>

              <Separator />

              <Section
                title="Bot protection"
                hint={
                  <>
                    DappDrill never solves a CAPTCHA. Let it in with a secret header your protection skips.{" "}
                    <a href="/bot" target="_blank" className="underline underline-offset-4">
                      How to set it up
                    </a>
                  </>
                }
              >
                {defaults.accessHeaderNames.length > 0 && (
                  <div className="flex flex-wrap items-center gap-4">
                    <span>
                      Stored: <span className="font-mono">{defaults.accessHeaderNames.join(", ")}</span>
                    </span>
                    <Check name="removeAccessHeaders" label="Remove" />
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Input name="accessHeaderName" autoComplete="off" spellCheck={false} placeholder="x-dappdrill-token" className="flex-[1_1_200px] font-mono" aria-label="Header name" />
                  <Input
                    name="accessHeaderValue"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={defaults.accessHeaderNames.length ? "Replace with a new secret" : "Secret value"}
                    className="flex-[2_1_260px] font-mono"
                    aria-label="Header value"
                  />
                </div>
                <p className="text-xs text-muted-foreground">Sent only to your app&apos;s own domain and stored encrypted.</p>
              </Section>

              <Separator />

              <Section title="Notes for the explorer">
                <Textarea id="hints" name="hints" rows={3} maxLength={2000} defaultValue={defaults.hints} placeholder="There's a referral flow at /invite. Skip the bridge page." aria-label="Notes for the explorer" />
              </Section>
            </div>
          </details>
        </CardContent>
        <CardFooter className="flex-wrap justify-between gap-2 border-t text-muted-foreground">
          <span>Usually takes 10–15 minutes. You can close this tab.</span>
          {usage && <span>{usage}</span>}
        </CardFooter>
      </Card>
    </form>
  );
}
