"use client";

import { chainName, type WalletProfileId } from "@dappdrill/core";
import { ArrowRight, Check, Clock, Globe, Network, ScanSearch } from "lucide-react";
import { startTransition, useActionState, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createAppAction } from "@/actions/apps";
import { AccountField } from "@/components/account-field";
import { HINT_FIELD, HintRows, useHints } from "@/components/app-hints";
import { chainNote, RpcField, useRpcCheck } from "@/components/rpc-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { SitePreview, useSite } from "@/components/site-preview";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ChainIcon, WALLETS, WalletIcon } from "@/components/web3-icons";
import type { ActionResult } from "@/lib/action-result";
import { CHAIN_GROUPS, CHAINS } from "@/lib/chains";
import { cn } from "@/lib/utils";

const DEFAULT_WALLET: WalletProfileId = "metamask";
const DETECT = "detect";
const OTHER = "other";
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
  const name = resolvedId === undefined ? undefined : chainName(resolvedId);
  // What a new account is sent can be on any chain we list, or on the one behind the RPC just typed.
  const fundChains = resolvedId === undefined || CHAINS.some((c) => c.id === resolvedId) ? CHAINS : [{ id: resolvedId, name: chainName(resolvedId) }, ...CHAINS];
  const rpcError = rpc.status === "bad" ? rpc.error : other && rpc.status === "idle" && state?.inline ? "Add the chain's RPC URL." : undefined;
  const customized = wallet !== DEFAULT_WALLET || chainId !== DETECT;
  // Hints already typed stay in view if the URL then changes, since they still get submitted.
  const hints = open || answers.started;

  // Not action={act}: React resets a form after its action runs, and on an error that puts the chain back on Detect.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => act(data));
  }

  // Enter in a field doesn't send the form: tests are generated from the button only.
  function holdEnter(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
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
    <form onSubmit={submit} onKeyDown={holdEnter} aria-busy={pending} className="mx-auto flex w-full max-w-xl flex-col gap-8 lg:max-w-none">
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
                      {CHAIN_GROUPS.map((group) => (
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

              {other && <RpcField ref={rpcInput} id="rpcUrl" value={rpcUrl} onChange={setRpcUrl} check={rpc} chain={name} invalid={Boolean(rpcError)} className="animate-in duration-200 fade-in-0 slide-in-from-top-1" />}

              {rpcError ? (
                <p role="alert" className="text-sm text-bad">
                  {rpcError}
                </p>
              ) : (
                <FieldDescription>{chainNote({ name, other })}</FieldDescription>
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
            <HintRows hints={answers} account={<AccountField chains={fundChains} chain={resolvedId} fieldClassName={HINT_FIELD} />} shown={hints} split={open} className="pt-2" />
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
