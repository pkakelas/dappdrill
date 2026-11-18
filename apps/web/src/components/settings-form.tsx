"use client";

import { BOT_GUIDE_URL, chainName, type WalletProfileId } from "@dappdrill/core";
import { Globe, Plus, ScanSearch, X } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { saveSettingsAction } from "@/actions/apps";
import { AccountField, CHIP, type AccountChoice, type FundDefault } from "@/components/account-field";
import { HintRows, useHints } from "@/components/app-hints";
import { chainNote, RpcField, useRpcCheck } from "@/components/rpc-field";
import { BrowserWindow, LastFrame } from "@/components/site-preview";
import { cx, SettingsSection } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ChainIcon, WALLETS, WalletIcon } from "@/components/web3-icons";
import type { ActionResult } from "@/lib/action-result";
import { CHAIN_GROUPS, CHAINS } from "@/lib/chains";

type OtherChain = { rpcUrl: string; chainId?: number };

export interface SettingsDefaults {
  name: string;
  url: string;
  hints: string;
  funding: string;
  signing: "allowed" | "setup" | "refused";
  chains: number[];
  otherChains: OtherChain[];
  wallets: WalletProfileId[];
  account: AccountChoice;
  fund: FundDefault[];
  /** The address of the saved key that holds funds. */
  keyAddress: string | null;
  headerNames: string[];
  storage: string;
  responses: string;
  schedule: string;
  verified: boolean;
}

const MAX_TOOLBAR_CHAINS = 3;

/** Lines up the questions with the sections around them. */
const SECTION_ROW = "sm:grid-cols-1 sm:gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-6";

const TIMES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

/** /new's note for one chain; the names when several are on. */
function chainsNote(names: string[], pendingOther: boolean) {
  if (names.length < 2) return chainNote({ name: names[0], other: pendingOther });
  return `Tests run on ${names.slice(0, -1).join(", ")} and ${names.at(-1)}. What a test signs is sent there.`;
}

function OtherChainRow({ row, onChange, onRemove }: { row: OtherChain; onChange: (change: Partial<OtherChain>) => void; onRemove: () => void }) {
  const check = useRpcCheck(row.rpcUrl, true);
  const found = check.status === "ok" ? check.chainId : undefined;
  useEffect(() => {
    if (found !== undefined) onChange({ chainId: found });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found]);
  return (
    <div className="flex animate-in flex-col gap-3 duration-200 fade-in-0 slide-in-from-top-1">
      <div className="flex items-center gap-1">
        <RpcField
          autoFocus={!row.rpcUrl}
          value={row.rpcUrl}
          onChange={(rpcUrl) => onChange({ rpcUrl, chainId: undefined })}
          check={check}
          chain={row.chainId === undefined ? undefined : chainName(row.chainId)}
          invalid={check.status === "bad"}
          className="flex-1"
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Remove this chain" onClick={onRemove} className="text-muted-foreground">
          <X />
        </Button>
      </div>
      {check.status === "bad" && (
        <p role="alert" className="text-sm text-bad">
          {check.error}
        </p>
      )}
    </div>
  );
}

/** One form, one Save, sections in the order people need them. */
export function SettingsForm({ appId, defaults: d, frame, seen, readOnly }: { appId: string; defaults: SettingsDefaults; frame: string | null; seen: string; readOnly?: boolean }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(saveSettingsAction, undefined);
  const [chains, setChains] = useState(d.chains);
  const [others, setOthers] = useState(() => d.otherChains.map((row, key) => ({ ...row, key })));
  const nextKey = useRef(d.otherChains.length);
  const [wallets, setWallets] = useState(d.wallets);
  const hints = useHints(d);

  // Typing marks the form as edited; the rest is compared, since buttons change it without a change event.
  const [edited, setEdited] = useState(false);
  const snapshot = JSON.stringify([chains, others.map((o) => o.rpcUrl), wallets, hints.text, hints.funding]);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = edited || snapshot !== savedSnapshot;
  const [saved, setSaved] = useState(false);
  const [saves, setSaves] = useState(0);
  useEffect(() => {
    if (!state?.ok) return;
    setEdited(false);
    setSavedSnapshot(snapshot);
    setSaved(true);
    setSaves((n) => n + 1);
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const pickedIds = [...new Set([...CHAINS.filter((c) => chains.includes(c.id)).map((c) => c.id), ...others.flatMap((o) => (o.chainId === undefined ? [] : [o.chainId]))])];
  // What a new account is sent is on one of the app's chains, or on any we list while the chain is detected.
  const fundChains = pickedIds.length ? pickedIds.map((id) => ({ id, name: chainName(id) })) : CHAINS;
  const detect = chains.length === 0 && others.length === 0;

  // Not action={act}: React resets a form after its action runs, and on an error that throws away what was typed.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => act(data));
  }

  const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list, item] : list.filter((other) => other !== item));

  return (
    <form onSubmit={submit} onChange={() => setEdited(true)} aria-busy={pending} className="flex flex-col">
      <input type="hidden" name="appId" value={appId} />
      {/* People who can only look get every field disabled. */}
      <fieldset disabled={readOnly} className="contents">

        <section aria-labelledby="app" className="grid gap-8 border-t py-8 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-5">
            <h2 id="app" className="text-base font-semibold">
              App
            </h2>
            <Field label="Name">
              <Input name="name" defaultValue={d.name} required maxLength={60} className="h-11" />
            </Field>
            <Field label="App URL">
              <InputGroup className="h-11">
                <InputGroupAddon>
                  <Globe />
                </InputGroupAddon>
                <InputGroupInput name="url" defaultValue={d.url} required autoComplete="url" inputMode="url" spellCheck={false} placeholder="app.example.com" />
              </InputGroup>
            </Field>
            <div id="wallets" className="flex flex-col gap-2">
              <p className="text-sm leading-none font-medium">Wallets</p>
              <div className="flex flex-wrap gap-2">
                {WALLETS.map((w) => (
                  <label key={w.id} className={CHIP}>
                    <input type="checkbox" name="wallet" value={w.id} checked={wallets.includes(w.id)} onChange={(event) => setWallets(toggle(wallets, w.id, event.target.checked))} className="sr-only" />
                    <WalletIcon wallet={w.id} />
                    {w.name}
                  </label>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">Your app sees these as installed browser wallets.</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <BrowserWindow
              url={d.url}
              toolbar={
                <>
                  {pickedIds.slice(0, MAX_TOOLBAR_CHAINS).map((id) => (
                    <span key={id} className="flex animate-in duration-300 zoom-in-50">
                      <ChainIcon chain={{ id }} />
                    </span>
                  ))}
                  {WALLETS.filter((w) => wallets.includes(w.id)).map((w) => (
                    <span key={w.id} className="flex animate-in duration-300 zoom-in-50">
                      <WalletIcon wallet={w.id} />
                    </span>
                  ))}
                </>
              }
            >
              <LastFrame src={frame} alt={`What DappDrill last saw on ${d.name}`} />
            </BrowserWindow>
            <p className="text-sm text-muted-foreground">{seen}</p>
          </div>
        </section>

        <SettingsSection id="chains" title="Chains" hint="Where your tests run.">
          <label className={cx(CHIP, "w-fit")}>
            <input type="checkbox" checked={detect} onChange={() => (setChains([]), setOthers([]))} className="sr-only" />
            <ScanSearch className="size-[18px]" />
            Detect automatically
          </label>
          {CHAIN_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{group.label}</p>
              <div className="flex flex-wrap gap-2">
                {group.chains.map((c) => (
                  <label key={c.id} className={CHIP}>
                    <input type="checkbox" name="chain" value={c.id} checked={chains.includes(c.id)} onChange={(event) => setChains(toggle(chains, c.id, event.target.checked))} className="sr-only" />
                    <ChainIcon chain={c} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {others.map((row) => (
            <OtherChainRow
              key={row.key}
              row={row}
              onChange={(change) => setOthers((rows) => rows.map((r) => (r.key === row.key ? { ...r, ...change } : r)))}
              onRemove={() => setOthers((rows) => rows.filter((r) => r.key !== row.key))}
            />
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => setOthers((rows) => [...rows, { key: nextKey.current++, rpcUrl: "" }])} className="-ml-2 self-start text-muted-foreground">
            <Plus />
            Other chain
          </Button>
          <FieldDescription>{chainsNote(pickedIds.map(chainName), others.length > 0)}</FieldDescription>
        </SettingsSection>

        {/* The app page links here as #account. */}
        <SettingsSection id="account" title="Account" hint="Who the tests are, and what pays for them on the chain.">
          <AccountField defaults={{ account: d.account, fund: d.fund }} chains={fundChains} chain={pickedIds[0]} saved={d.keyAddress} cleared={saves} onEdit={() => setEdited(true)} />
        </SettingsSection>

        <section aria-labelledby="context" className="flex flex-col gap-7 border-t py-8">
          <div className="flex flex-col gap-1.5">
            <h2 id="context" className="text-base font-semibold">
              What DappDrill should know
            </h2>
            <p className="text-sm text-muted-foreground">It reads these each time it makes or repairs a test.</p>
          </div>
          <HintRows hints={hints} rowClassName={SECTION_ROW} />
        </section>

        <SettingsSection id="signing" title="Signing" hint="What tests may approve in the wallet. Rejecting a request is always allowed.">
          <Field label="In the wallet, tests may">
            <NativeSelect name="signing" defaultValue={d.signing}>
              <NativeSelectOption value="allowed">Approve what the test needs</NativeSelectOption>
              <NativeSelectOption value="setup">Approve only during setup, such as signing in</NativeSelectOption>
              <NativeSelectOption value="refused">Approve nothing</NativeSelectOption>
            </NativeSelect>
          </Field>
          <p className="text-sm text-muted-foreground">What a test approves is sent to the chain the app uses. Pick one of the others for tests that should only look, or for an app that makes an account of whoever signs in.</p>
        </SettingsSection>

        <SettingsSection id="schedule" title="Daily run" hint="Runs every test once a day and alerts the organization when one stops passing.">
          <Field label="Time (UTC)">
            <NativeSelect name="schedule" defaultValue={d.schedule}>
              <NativeSelectOption value="">Off</NativeSelectOption>
              {TIMES.map((t) => (
                <NativeSelectOption key={t} value={t}>
                  {t}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {!d.verified && (
            <p className="text-sm text-muted-foreground">
              Needs the app&apos;s domain verified first, in{" "}
              <Link href="/organization#domains" className="underline underline-offset-4 hover:text-foreground">
                Organization settings
              </Link>
              .
            </p>
          )}
        </SettingsSection>

        {/* Remounted after a save, which clears the secret that was just stored. */}
        <SettingsSection
          key={saves}
          id="access"
          title="Bot protection"
          hint={
            <>
              DappDrill never solves CAPTCHAs. If your site has a bot check, let it in with a header your firewall allows.{" "}
              <a href={BOT_GUIDE_URL} className="underline underline-offset-4 hover:text-foreground">
                How to set it up
              </a>
            </>
          }
        >
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <Field label="Header name">
              <Input name="headerName" className="font-mono" placeholder={d.headerNames[0] ?? "x-dappdrill-token"} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Value">
              <Input name="headerValue" type="password" className="font-mono" placeholder={d.headerNames.length ? "Saved. Paste a new one to replace it." : ""} autoComplete="off" />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">Sent only to your own domain, never to RPCs or other sites.</p>
          {d.headerNames.length > 0 && <Check name="removeHeaders">Remove the saved header ({d.headerNames.join(", ")})</Check>}
        </SettingsSection>

        <SettingsSection id="app-setup" title="Before the app loads" hint="For an app that needs a flag set to be tested, or a request the tests shouldn't depend on.">
          <Field label="localStorage" hint="key=value, one per line. Set before the app loads.">
            <Textarea name="storage" defaultValue={d.storage} rows={2} className="font-mono" placeholder="testMode=true" spellCheck={false} />
          </Field>
          <Field label="Fixed responses" hint='"<url> [status] <body>", one per line. * matches anything.'>
            <Textarea name="responses" defaultValue={d.responses} rows={2} className="font-mono" placeholder='https://api.example.com/health {"ok":true}' spellCheck={false} />
          </Field>
        </SettingsSection>
      </fieldset>

      {readOnly && <p className="border-t py-4 text-sm text-muted-foreground">Only admins and owners can change an app&apos;s settings.</p>}

      {/* Only there while there is something to save, and briefly to say it saved. */}
      <div className={cx("sticky bottom-0 z-10 flex items-center gap-4 border-t bg-background py-4", (readOnly || !(dirty || pending || saved || state?.error)) && "hidden")}>
        <Button type="submit" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
        {dirty && !pending && !state?.error && <p className="text-sm text-muted-foreground">Unsaved changes</p>}
        {state?.error && (
          <p role="alert" className="text-sm text-bad">
            {state.error}
          </p>
        )}
        {saved && !dirty && (
          <p role="status" className="text-sm text-muted-foreground">
            Saved.
          </p>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm leading-none font-medium">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Check({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-muted-foreground">
      <Checkbox name={name} value="1" />
      {children}
    </label>
  );
}
