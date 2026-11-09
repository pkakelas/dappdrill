"use client";

import { KNOWN_CHAINS, MAINNET_CHAIN_IDS, chainInfo, chainName, type WalletProfileId } from "@dappdrill/core";
import { ArrowRight, Check, Clock, Globe, Network, ScanSearch } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createAppAction } from "@/actions/apps";
import { HintRows, LiveKeyField, useHints } from "@/components/app-hints";
import { chainNote, RpcField, TestnetTick, useRpcCheck } from "@/components/rpc-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SitePreview, useSite } from "@/components/site-preview";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ChainIcon, WalletIcon } from "@/components/web3-icons";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";

const DEFAULT_WALLET: WalletProfileId = "metamask";
const DETECT = "detect";
const OTHER = "other";
const WALLETS: { id: WalletProfileId; name: string }[] = [
  { id: "metamask", name: "MetaMask" },
  { id: "rabby", name: "Rabby" },
  { id: "coinbase", name: "Coinbase Wallet" },
];
const CHAINS = KNOWN_CHAINS.filter((c) => c.id !== 31337 && c.forkable);
const MAINNETS = CHAINS.filter((c) => !c.testnet);
const TESTNETS = CHAINS.filter((c) => c.testnet);
const WIDE = "(min-width: 64rem)";
const MOTION = "duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none";

/** Side by side needs the lg breakpoint; below it the preview opens inside the card. */
function useWide(): boolean {
  return useSyncExternalStore(
    (change) => {
      const query = matchMedia(WIDE);
      query.addEventListener("change", change);
      return () => query.removeEventListener("change", change);
    },
    () => matchMedia(WIDE).matches,
    () => false,
  );
}

export function NewAppForm({ orgId, children }: { orgId: string; children: ReactNode }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(createAppAction, undefined);
  const [url, setUrl] = useState("");
  const [wallet, setWallet] = useState<WalletProfileId>(DEFAULT_WALLET);
  const [chainId, setChainId] = useState(DETECT);
  const [rpcUrl, setRpcUrl] = useState("");
  const [ticked, setTicked] = useState(false);
  const [liveKey, setLiveKey] = useState("");
  const answers = useHints();
  const rpcInput = useRef<HTMLInputElement>(null);
  const { site, open, looking, missed } = useSite(url);
  const wide = useWide();

  const other = chainId === OTHER;
  // The RPC field mounts after the choice; typing goes there next.
  useEffect(() => {
    if (other) rpcInput.current?.focus();
  }, [other]);
  const rpc = useRpcCheck(rpcUrl, other);
  const picked = CHAINS.find((c) => String(c.id) === chainId);
  const resolvedId = picked?.id ?? (rpc.status === "ok" ? rpc.chainId : undefined);
  const known = resolvedId === undefined ? undefined : chainInfo(resolvedId);
  // Only a chain we can't place needs the user's word that it's a testnet.
  const askTestnet = resolvedId !== undefined && !known && !MAINNET_CHAIN_IDS.has(resolvedId);
  const testnet = Boolean(known?.testnet || (askTestnet && ticked));
  const live = testnet && Boolean(liveKey.trim());
  const name = resolvedId === undefined ? undefined : chainName(resolvedId);
  const rpcError = rpc.status === "bad" ? rpc.error : other && rpc.status === "idle" && state?.inline ? "Add the chain's RPC URL." : undefined;
  const customized = wallet !== DEFAULT_WALLET || chainId !== DETECT;
  // Hints already typed stay in view if the URL then changes, since they still get submitted.
  const hints = open || answers.started || Boolean(liveKey.trim());

  // Not action={act}: React resets a form after its action runs, and on an error that puts the chain back on Detect.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => act(data));
  }

  const preview = site && (
    <SitePreview
      site={site}
      open={open}
      toolbar={
        <>
          {resolvedId !== undefined && (
            <span key={resolvedId} className="flex animate-in duration-300 zoom-in-50">
              <ChainIcon chain={{ id: resolvedId }} />
            </span>
          )}
          <span key={wallet} className="flex animate-in duration-300 zoom-in-50">
            <WalletIcon wallet={wallet} />
          </span>
        </>
      }
    />
  );

  return (
    <form onSubmit={submit} aria-busy={pending} className="mx-auto flex w-full max-w-xl flex-col gap-8 lg:max-w-none">
      <input type="hidden" name="orgId" value={orgId} readOnly />
      <input type="hidden" name="customized" value={customized ? "1" : ""} readOnly />
      {picked && <input type="hidden" name="chain" value={picked.id} readOnly />}

      <div className="grid gap-8 lg:grid-cols-2">
        <div className={cn("min-w-0 transition-transform", MOTION, !open && "lg:translate-x-[calc(50%+1rem)]")}>
          <Card className="h-full gap-0 py-0">
            <CardContent className="flex flex-col gap-5 p-6">
              <Field>
                <FieldLabel htmlFor="url">App URL</FieldLabel>
                <InputGroup className="h-11">
                  <InputGroupAddon>
                    <Globe />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="url"
                    name="url"
                    required
                    autoFocus
                    autoComplete="url"
                    inputMode="url"
                    spellCheck={false}
                    placeholder="app.example.com"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    className="text-base md:text-base"
                  />
                  {(looking || open) && (
                    <InputGroupAddon align="inline-end">{looking ? <Spinner /> : <Check className="animate-in duration-300 zoom-in-50" />}</InputGroupAddon>
                  )}
                </InputGroup>
                {missed && <FieldDescription className="animate-in duration-200 fade-in-0">We couldn&apos;t reach this site from here. You can still add it.</FieldDescription>}
              </Field>

              {!wide && (
                <div className={cn("-mt-5 grid transition-[grid-template-rows]", MOTION, open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="pt-5">{preview}</div>
                  </div>
                </div>
              )}

              <div className="grid gap-5 sm:grid-cols-2 sm:gap-3">
                <Field>
                  <FieldLabel htmlFor="wallet">Wallet</FieldLabel>
                  <Select name="wallet" value={wallet} onValueChange={(value) => setWallet(value as WalletProfileId)}>
                    <SelectTrigger id="wallet" className="w-full data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectLabel className="max-w-60">Your app sees this one first. You can test others later.</SelectLabel>
                        {WALLETS.map((option) => (
                          <SelectItem key={option.id} value={option.id}>
                            <WalletIcon wallet={option.id} />
                            {option.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="chain">Chain</FieldLabel>
                  <Select
                    value={chainId}
                    onValueChange={setChainId}
                  >
                    <SelectTrigger id="chain" className="w-full data-[size=default]:h-11">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      position="popper"
                      onCloseAutoFocus={(event) => {
                        // The RPC field is where typing goes next; the trigger would take the focus back.
                        if (!other) return;
                        event.preventDefault();
                        rpcInput.current?.focus();
                      }}
                    >
                      <SelectItem value={DETECT}>
                        <ScanSearch className="size-[18px]" />
                        Detect automatically
                      </SelectItem>
                      {[
                        { label: "Mainnets", chains: MAINNETS },
                        { label: "Testnets", chains: TESTNETS },
                      ].map((group) => (
                        <SelectGroup key={group.label}>
                          <SelectLabel>{group.label}</SelectLabel>
                          {group.chains.map((option) => (
                            <SelectItem key={option.id} value={String(option.id)}>
                              <ChainIcon chain={option} />
                              {option.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      <SelectSeparator />
                      <SelectItem value={OTHER}>
                        <Network className="size-[18px]" />
                        Other chain
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {other && (
                <div className="flex animate-in flex-col gap-3 duration-200 fade-in-0 slide-in-from-top-1">
                  <RpcField ref={rpcInput} id="rpcUrl" value={rpcUrl} onChange={setRpcUrl} check={rpc} chain={name} invalid={Boolean(rpcError)} />
                  {askTestnet && <TestnetTick name="testnet" value="1" checked={ticked} onChange={setTicked} />}
                </div>
              )}

              {rpcError ? (
                <p role="alert" className="text-sm text-bad">
                  {rpcError}
                </p>
              ) : (
                <FieldDescription>{chainNote({ name, other, testnet, live, forkable: known?.forkable ?? true })}</FieldDescription>
              )}
            </CardContent>
          </Card>
        </div>

        {wide && (
          <div className="relative min-w-0">
            <div className="absolute inset-0">{preview}</div>
          </div>
        )}
      </div>

      <div className={cn("mx-auto flex w-full flex-col gap-8 transition-[max-width]", MOTION, open ? "lg:max-w-full" : "lg:max-w-[calc(50%-1rem)]")}>
        <div inert={!hints} className={cn("grid transition-[grid-template-rows,margin]", MOTION, hints ? "grid-rows-[1fr]" : "-mb-8 grid-rows-[0fr]")}>
          <div className="-mx-1 min-h-0 overflow-hidden px-1 pb-1">
            <HintRows
              hints={answers}
              hasKey={Boolean(liveKey.trim())}
              keyField={testnet && <LiveKeyField value={liveKey} onChange={setLiveKey} />}
              shown={hints}
              split={open}
              className="pt-2"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {state?.error && !state.inline && (
            <p role="alert" className="text-sm text-bad">
              {state.error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Clock className="size-3.5" />
              First tests in a few minutes
            </p>
            <Button type="submit" size="lg" disabled={pending} className="group max-sm:w-full">
              {pending ? (
                <>
                  <Spinner />
                  Opening app…
                </>
              ) : (
                <>
                  Generate tests
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                </>
              )}
            </Button>
          </div>
        </div>

        {children}
      </div>
    </form>
  );
}
