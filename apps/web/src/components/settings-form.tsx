"use client";

import { BOT_GUIDE_URL, FORK_GUIDE_URL, KNOWN_CHAINS, type WalletProfileId } from "@dappdrill/core";
import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { saveSettingsAction } from "@/actions/apps";
import { cx, SettingsSection } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { toggleVariants } from "@/components/ui/toggle";
import type { ActionResult } from "@/lib/action-result";

export interface SettingsDefaults {
  name: string;
  url: string;
  hints: string;
  chains: number[];
  customChains: string;
  wallets: WalletProfileId[];
  liveKeyAddress: string | null;
  headerNames: string[];
  storage: string;
  responses: string;
  schedule: string;
  verified: boolean;
}

const WALLETS: { id: WalletProfileId; name: string }[] = [
  { id: "metamask", name: "MetaMask" },
  { id: "rabby", name: "Rabby" },
  { id: "coinbase", name: "Coinbase Wallet" },
];

/** A checkbox drawn as an outline toggle; a real input, so the form posts it and sees the change. */
const CHIP = cx(
  toggleVariants({ variant: "outline" }),
  "relative cursor-pointer px-3 select-none has-checked:border-primary has-checked:bg-primary has-checked:text-primary-foreground has-focus-visible:border-ring has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
);

const TIMES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

/** One form, one Save, sections in the order people need them. */
export function SettingsForm({ appId, defaults: d }: { appId: string; defaults: SettingsDefaults }) {
  const [state, act, pending] = useActionState<ActionResult, FormData>(saveSettingsAction, undefined);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!state?.ok) return;
    setDirty(false);
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <form action={act} onChange={() => setDirty(true)} className="flex flex-col">
      <input type="hidden" name="appId" value={appId} />

      <SettingsSection id="app" title="App">
        <Field label="Name">
          <Input name="name" defaultValue={d.name} required maxLength={60} />
        </Field>
        <Field label="URL">
          <Input name="url" defaultValue={d.url} required spellCheck={false} />
        </Field>
        <Field label="Notes for DappDrill" hint="Where things are, what to use. It reads these before every run.">
          <Textarea name="hints" defaultValue={d.hints} rows={3} maxLength={2000} placeholder="The swap is under /trade. Use USDC on Base." />
        </Field>
      </SettingsSection>

      <SettingsSection id="schedule" title="Daily run" hint="Runs every test once a day and alerts the team when one stops passing.">
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
            <Link href="/account#domains" className="underline underline-offset-4 hover:text-foreground">
              Account
            </Link>
            .
          </p>
        )}
      </SettingsSection>

      <SettingsSection id="chains" title="Chains" hint="Leave all off to use what the app asks for. Chains run on local forks; a testnet that can't be forked runs live. Nothing touches mainnet.">
        <div className="flex flex-wrap gap-2">
          {KNOWN_CHAINS.filter((c) => c.id !== 31337).map((c) => (
            <label key={c.id} className={CHIP}>
              <input type="checkbox" name="chain" value={c.id} defaultChecked={d.chains.includes(c.id)} className="sr-only" />
              {c.name}
            </label>
          ))}
        </div>
        <Field label="Other chains" hint={'One per line: "<chain id> <rpc url>". Add "live" for a testnet that can\'t be forked. Without the funded key below, tests there get a new account each run that can sign but not pay for transactions.'}>
          <Textarea name="customChains" defaultValue={d.customChains} rows={2} className="font-mono" placeholder="129302 https://rpc.example.org live" spellCheck={false} />
        </Field>
        <Field label="Funded testnet key" hint={d.liveKeyAddress ? `Saved for ${d.liveKeyAddress}. Paste a new one to replace it.` : "Only for live testnets. Stored encrypted, never shown again."}>
          <Input name="liveKey" type="password" autoComplete="off" className="font-mono" placeholder="0x…" />
        </Field>
        {d.liveKeyAddress && <Check name="removeLiveKey">Remove the saved key</Check>}
      </SettingsSection>

      <SettingsSection id="wallets" title="Wallets" hint="Which browser wallets the tests pretend to be.">
        <div className="flex flex-wrap gap-2">
          {WALLETS.map((w) => (
            <label key={w.id} className={CHIP}>
              <input type="checkbox" name="wallet" value={w.id} defaultChecked={d.wallets.includes(w.id)} className="sr-only" />
              {w.name}
            </label>
          ))}
        </div>
      </SettingsSection>

      <SettingsSection
        id="access"
        title="Bot protection"
        hint={
          <>
            DappDrill never solves CAPTCHAs. If your site has a bot check, let it in with a header your firewall allows.{" "}
            <a href={BOT_GUIDE_URL} className="underline underline-offset-4 hover:text-foreground">
              How
            </a>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <Field label="Header name">
            <Input name="headerName" className="font-mono" placeholder={d.headerNames[0] ?? "x-dappdrill-key"} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Value">
            <Input name="headerValue" type="password" className="font-mono" placeholder={d.headerNames.length ? "Saved. Paste a new one to replace it." : ""} autoComplete="off" />
          </Field>
        </div>
        <p className="text-sm text-muted-foreground">Sent only to your own domain, never to RPCs or other sites.</p>
        {d.headerNames.length > 0 && <Check name="removeHeaders">Remove the saved header ({d.headerNames.join(", ")})</Check>}
      </SettingsSection>

      <SettingsSection
        id="setup"
        title="Fork setup"
        hint={
          <>
            For apps that need a flag to work on a fork, or a backend that disagrees with it.{" "}
            <a href={FORK_GUIDE_URL} className="underline underline-offset-4 hover:text-foreground">
              How
            </a>
          </>
        }
      >
        <Field label="localStorage" hint="key=value, one per line. Set before the app loads.">
          <Textarea name="storage" defaultValue={d.storage} rows={2} className="font-mono" placeholder="forkMode=true" spellCheck={false} />
        </Field>
        <Field label="Fixed responses" hint='"<url> [status] <body>", one per line. * matches anything.'>
          <Textarea name="responses" defaultValue={d.responses} rows={2} className="font-mono" placeholder='https://api.example.com/health {"ok":true}' spellCheck={false} />
        </Field>
      </SettingsSection>

      {/* Sticks to the bottom only while there is something to save, and briefly to say it saved. */}
      <div className={cx("bottom-0 z-10 flex items-center gap-4 border-t bg-background py-4", (dirty || saved || state?.error) && "sticky")}>
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
