"use client";

import { BOT_GUIDE_URL, FORK_GUIDE_URL, KNOWN_CHAINS, type WalletProfileId } from "@dappdrill/core";
import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { saveSettingsAction } from "@/actions/apps";
import { cx, SettingsSection } from "@/components/ui";
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
          <input name="name" defaultValue={d.name} required maxLength={60} className="field" />
        </Field>
        <Field label="URL">
          <input name="url" defaultValue={d.url} required className="field font-mono text-[14px]" spellCheck={false} />
        </Field>
        <Field label="Notes for DappDrill" hint="Where things are, what to use. It reads these before every run.">
          <textarea name="hints" defaultValue={d.hints} rows={3} maxLength={2000} className="field" placeholder="The swap is under /trade. Use USDC on Base." />
        </Field>
      </SettingsSection>

      <SettingsSection id="schedule" title="Daily run" hint="Runs every test once a day and alerts the team when one stops passing.">
        <Field label="Time (UTC)">
          <select name="schedule" defaultValue={d.schedule} className="field w-fit pr-8">
            <option value="">Off</option>
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        {!d.verified && (
          <p className="hint m-0 text-[13px]">
            Needs the app&apos;s domain verified first, in <Link href="/account#domains">Account</Link>.
          </p>
        )}
      </SettingsSection>

      <SettingsSection id="chains" title="Chains" hint="Leave all off to use what the app asks for. Every chain runs on a local fork; nothing touches mainnet.">
        <div className="flex flex-wrap gap-2">
          {KNOWN_CHAINS.filter((c) => c.id !== 31337).map((c) => (
            <label key={c.id} className="chip h-9">
              <input type="checkbox" name="chain" value={c.id} defaultChecked={d.chains.includes(c.id)} className="sr-only" />
              {c.name}
            </label>
          ))}
        </div>
        <Field label="Other chains" hint={'One per line: "<chain id> <rpc url>". Add "live" for a testnet that can\'t be forked; it needs the funded key below.'}>
          <textarea name="customChains" defaultValue={d.customChains} rows={2} className="field font-mono text-[13px]" placeholder="129302 https://rpc.example.org live" spellCheck={false} />
        </Field>
        <Field label="Funded testnet key" hint={d.liveKeyAddress ? `Saved for ${d.liveKeyAddress}. Paste a new one to replace it.` : "Only for live testnets. Stored encrypted, never shown again."}>
          <input name="liveKey" type="password" autoComplete="off" className="field font-mono text-[13px]" placeholder="0x…" />
        </Field>
        {d.liveKeyAddress && <Check name="removeLiveKey">Remove the saved key</Check>}
      </SettingsSection>

      <SettingsSection id="wallets" title="Wallets" hint="Which browser wallets the tests pretend to be.">
        <div className="flex flex-wrap gap-2">
          {WALLETS.map((w) => (
            <label key={w.id} className="chip h-9">
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
            DappDrill never solves CAPTCHAs. If your site has a bot check, let it in with a header your firewall allows. <a href={BOT_GUIDE_URL}>How</a>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <Field label="Header name">
            <input name="headerName" className="field font-mono text-[13px]" placeholder={d.headerNames[0] ?? "x-dappdrill-key"} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Value">
            <input name="headerValue" type="password" className="field font-mono text-[13px]" placeholder={d.headerNames.length ? "Saved. Paste a new one to replace it." : ""} autoComplete="off" />
          </Field>
        </div>
        <p className="hint m-0 text-[13px]">Sent only to your own domain, never to RPCs or other sites.</p>
        {d.headerNames.length > 0 && <Check name="removeHeaders">Remove the saved header ({d.headerNames.join(", ")})</Check>}
      </SettingsSection>

      <SettingsSection
        id="setup"
        title="Fork setup"
        hint={
          <>
            For apps that need a flag to work on a fork, or a backend that disagrees with it. <a href={FORK_GUIDE_URL}>How</a>
          </>
        }
      >
        <Field label="localStorage" hint="key=value, one per line. Set before the app loads.">
          <textarea name="storage" defaultValue={d.storage} rows={2} className="field font-mono text-[13px]" placeholder="forkMode=true" spellCheck={false} />
        </Field>
        <Field label="Fixed responses" hint='"<url> [status] <body>", one per line. * matches anything.'>
          <textarea name="responses" defaultValue={d.responses} rows={2} className="field font-mono text-[13px]" placeholder='https://api.example.com/health {"ok":true}' spellCheck={false} />
        </Field>
      </SettingsSection>

      {/* Sticks to the bottom only while there is something to save, and briefly to say it saved. */}
      <div className={cx("bottom-0 z-10 flex items-center gap-4 border-t border-line bg-paper py-4", (dirty || saved || state?.error) && "sticky")}>
        <button type="submit" className="btn btn-primary" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {dirty && !pending && !state?.error && <p className="m-0 text-[14px] text-muted">Unsaved changes</p>}
        {state?.error && (
          <p role="alert" className="m-0 text-[14px] text-bad">
            {state.error}
          </p>
        )}
        {saved && !dirty && (
          <p role="status" className="m-0 text-[14px] text-muted">
            Saved.
          </p>
        )}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint text-[13px]">{hint}</span>}
    </label>
  );
}

function Check({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-[14px] text-ink-3">
      <input type="checkbox" name={name} value="1" className="accent-ink" />
      {children}
    </label>
  );
}
