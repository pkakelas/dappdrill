"use server";

import {
  KNOWN_CHAINS,
  MAINNET_CHAIN_IDS,
  newId,
  parseFixedResponse,
  parseStorageEntry,
  CONNECTED,
  WalletProfileId,
  chainInfo,
  type Action,
  type ChainConfig,
  type FixedResponse,
} from "@dappdrill/core";
import { apps, db, encrypt, makes, testRuns, tests, updateApp, type AppSettings } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { hostOf } from "@/lib/domains";
import { withOwnerHints } from "@/lib/hints";
import { startMake } from "@/lib/make";
import { readChainId } from "@/lib/rpc";
import { looksLikeKey } from "@/lib/secrets";
import { can, denied } from "@/lib/permissions";
import { orgAccess, requireApp, requireUser } from "@/lib/session";
import { readSite, type SiteInfo } from "@/lib/site";

const Url = z
  .string()
  .trim()
  .min(1, "Paste your app's URL.")
  .transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.string().url("That doesn't look like a URL."))
  .transform((s) => {
    const u = new URL(s);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  });

function nameFromHost(host: string): string {
  const parts = host.replace(/^www\./, "").replace(/:\d+$/, "").split(".");
  const word = parts.length > 2 ? parts[parts.length - 2]! : parts[0]!;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** /new: what the form's preview shows once a URL is in. */
export async function previewSiteAction(input: string): Promise<SiteInfo | undefined> {
  await requireUser();
  const url = Url.safeParse(input);
  return url.success ? readSite(url.data) : undefined;
}

const KeyHex = z
  .string()
  .trim()
  .transform((s) => (s.startsWith("0x") ? s : `0x${s}`))
  .pipe(z.string().regex(/^0x[0-9a-fA-F]{64}$/, "The private key is 64 hex characters."));

const RpcUrl = z
  .string()
  .trim()
  .min(1, "Add the chain's RPC URL.")
  .transform((s) => (/^https?:\/\//i.test(s) ? s : `https://${s}`))
  .pipe(z.string().url("That doesn't look like a URL."));
const NO_CHAIN = "No chain answered at that URL.";

/** /new: tells the form which chain an RPC belongs to while the user is still typing. */
/** A chain that can't be forked runs for real, so an app on it starts with a way to get test funds. */
const noFunds = (chain: string) => `${chain} can't be forked, so the tests run on the real network. Paste a private key that holds test funds there, or tell us how to get them.`;

export async function checkRpcAction(input: string): Promise<{ chainId?: number; error?: string }> {
  await requireUser();
  const url = RpcUrl.safeParse(input);
  if (!url.success) return { error: url.error.issues[0]?.message };
  const chainId = await readChainId(url.data);
  return chainId === undefined ? { error: NO_CHAIN } : { chainId };
}

/**
 * /new: find or create the app for this URL. A new app (or one with no tests yet) gets its tests made.
 * Anyone in the organization can add an app; changing one that exists is for admins and owners.
 */
export async function createAppAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await orgAccess(form.get("orgId"));
  if ("error" in a) return a;
  const url = Url.safeParse(form.get("url"));
  if (!url.success) return { error: url.error.issues[0]?.message };
  const customized = form.get("customized") === "1";
  const hints = String(form.get("hints") ?? "").trim().slice(0, 4000);
  const funding = String(form.get("funding") ?? "").trim().slice(0, 1000);
  if (looksLikeKey(hints) || looksLikeKey(funding)) return { error: "That looks like a private key. Text boxes aren't encrypted, so take it out.", inline: true };
  const keyIn = String(form.get("liveKey") ?? "").trim();
  let wallets: AppSettings["wallets"] = ["metamask"];
  const chains: ChainConfig[] = [];

  if (customized) {
    const wallet = WalletProfileId.safeParse(form.get("wallet"));
    if (!wallet.success) return { error: "Choose a primary wallet." };
    wallets = [wallet.data];
    const chainId = form.get("chain");
    if (form.has("rpcUrl")) {
      const rpc = RpcUrl.safeParse(form.get("rpcUrl"));
      if (!rpc.success) return { error: rpc.error.issues[0]?.message, inline: true };
      const id = await readChainId(rpc.data);
      if (id === undefined) return { error: NO_CHAIN, inline: true };
      const info = chainInfo(id);
      const testnet = info ? info.testnet : form.get("testnet") === "1";
      if (info?.forkable === false && !keyIn && !funding) return { error: noFunds(info.name) };
      chains.push({ id, name: info?.name, rpcUrl: rpc.data, mode: (testnet && keyIn) || info?.forkable === false ? "live" : "fork" });
    } else if (chainId) {
      const info = KNOWN_CHAINS.find((c) => c.id === Number(chainId) && c.id !== 31337);
      if (!info) return { error: "Choose a supported chain." };
      if (!info.forkable && !keyIn && !funding) return { error: noFunds(info.name) };
      // A key is what opts a testnet into running live, and a chain that can't be forked always is. Everything else, mainnets included, is a local fork.
      chains.push({ id: info.id, name: info.name, rpcUrl: info.rpcUrl, mode: !info.forkable || (info.testnet && keyIn) ? "live" : "fork" });
    }
  }
  if (chains.some((c) => c.mode === "live" && MAINNET_CHAIN_IDS.has(c.id))) return { error: "Live mode is for testnets only. Mainnet chains always run on a local fork." };

  const [existing] = await db().select().from(apps).where(and(eq(apps.organizationId, a.org.id), eq(apps.url, url.data)));
  let liveKey: { liveKeyEnc: string; liveKeyAddress: string } | undefined;
  if (keyIn && chains.some((c) => c.mode === "live")) {
    const key = KeyHex.safeParse(keyIn);
    if (!key.success) return { error: key.error.issues[0]?.message };
    liveKey = { liveKeyEnc: encrypt(key.data), liveKeyAddress: privateKeyToAccount(key.data as `0x${string}`).address };
  }

  const funds = funding ? { funding } : {};
  const settingsBase: AppSettings = { wallets, chains, ...funds };

  let appId = existing?.id;
  if (!existing) {
    appId = newId("app");
    const host = hostOf(url.data);
    await db()
      .insert(apps)
      .values({
        id: appId,
        organizationId: a.org.id,
        name: nameFromHost(host),
        url: url.data,
        host,
        settings: settingsBase,
        // Every test starts as a user whose wallet is connected; what the owner answered is the app's first notes.
        suite: { setup: CONNECTED, notes: withOwnerHints([], hints), signing: "allowed" },
        ...liveKey,
      });
  } else if (can(a.role, "apps.manage") && (customized || hints || funding || liveKey)) {
    const settings = customized ? { ...existing.settings, ...settingsBase } : { ...existing.settings, ...funds };
    // The suite is changed as the row holds it now: a make may be writing notes to it.
    await updateApp(db(), existing.id, (now) => ({ settings, ...(hints ? { suite: { ...now.suite, notes: withOwnerHints(now.suite.notes, hints) } } : {}), ...liveKey }));
  }
  const hasTests = existing ? (await db().select({ id: tests.id }).from(tests).where(eq(tests.appId, existing.id)).limit(1)).length > 0 : false;
  if (!hasTests) await startMake(appId!, a.user.id);
  revalidatePath("/", "layout"); // the app switcher lists it
  redirect(`/apps/${appId}`);
}

// ---------------------------------------------------------------- settings

const Signing = z.enum(["allowed", "setup", "refused"]);

export async function saveSettingsAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { app, role } = await requireApp(String(form.get("appId")));
  if (!can(role, "apps.manage")) return { error: denied("apps.manage") };
  const name = String(form.get("name") ?? "").trim().slice(0, 60);
  if (!name) return { error: "Give the app a name." };
  const url = Url.safeParse(form.get("url"));
  if (!url.success) return { error: url.error.issues[0]?.message };

  const hints = String(form.get("hints") ?? "").trim().slice(0, 4000);
  const funding = String(form.get("funding") ?? "").trim().slice(0, 1000);
  if (looksLikeKey(hints) || looksLikeKey(funding)) return { error: "That looks like a private key. Text boxes aren't encrypted, so take it out." };

  const keyIn = String(form.get("liveKey") ?? "").trim();
  const removeKey = form.get("removeLiveKey") === "1";
  // As on /new, a key is what opts a testnet into running live.
  const hasKey = !removeKey && Boolean(keyIn || app.liveKeyAddress);

  const known = form
    .getAll("chain")
    .map(Number)
    .map((id) => KNOWN_CHAINS.find((c) => c.id === id))
    .filter((c) => c !== undefined)
    .map((c): ChainConfig => ({ id: c.id, name: c.name, rpcUrl: c.rpcUrl, mode: !c.forkable || (c.testnet && hasKey) ? "live" : "fork" }));

  const ticked = new Set(form.getAll("testnetRpc"));
  const others: ChainConfig[] = [];
  for (const input of form.getAll("rpcUrl").map(String).filter((s) => s.trim())) {
    const rpc = RpcUrl.safeParse(input);
    if (!rpc.success) return { error: rpc.error.issues[0]?.message };
    // A saved chain doesn't have to answer right now for the rest of the page to save.
    const saved = app.settings.chains.find((c) => c.rpcUrl === rpc.data);
    const id = saved?.id ?? (await readChainId(rpc.data));
    if (id === undefined) return { error: `${NO_CHAIN} ${rpc.data}` };
    const info = chainInfo(id);
    const testnet = info ? info.testnet : ticked.has(input) && !MAINNET_CHAIN_IDS.has(id);
    const live = info?.forkable === false || (testnet && (hasKey || (!info && saved?.mode === "live")));
    others.push({ id, name: info?.name ?? saved?.name, rpcUrl: rpc.data, mode: live ? "live" : "fork" });
  }

  // One entry per chain, and an RPC the user gave beats ours. Keep fork blocks already pinned for chains that stay.
  const picked = new Map([...known, ...others].map((c) => [c.id, c]));
  const chains = [...picked.values()].map((c) => ({ ...c, forkBlock: app.settings.chains.find((o) => o.id === c.id && o.rpcUrl === c.rpcUrl)?.forkBlock }));
  if (chains.some((c) => c.mode === "live" && MAINNET_CHAIN_IDS.has(c.id))) return { error: "Live mode is for testnets only. Mainnet chains always run on a local fork." };

  const wallets = form.getAll("wallet").map((w) => WalletProfileId.safeParse(w)).flatMap((r) => (r.success ? [r.data] : []));
  if (wallets.length === 0) return { error: "Pick at least one wallet." };

  let liveKey: { enc: string | null; address: string | null } | undefined;
  if (removeKey) liveKey = { enc: null, address: null };
  else if (keyIn) {
    const k = KeyHex.safeParse(keyIn);
    if (!k.success) return { error: k.error.issues[0]?.message };
    liveKey = { enc: encrypt(k.data), address: privateKeyToAccount(k.data as `0x${string}`).address };
  }

  let headers: { enc: string | null; names: string[] } | undefined;
  const headerName = String(form.get("headerName") ?? "").trim();
  const headerValue = String(form.get("headerValue") ?? "").trim();
  if (form.get("removeHeaders") === "1") headers = { enc: null, names: [] };
  else if (headerName || headerValue) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(headerName)) return { error: "Header names are letters, digits and dashes." };
    if (!headerValue || headerValue.length > 512) return { error: "Paste the header's value." };
    headers = { enc: encrypt(JSON.stringify({ [headerName]: headerValue })), names: [headerName] };
  }

  const storage: Record<string, string> = {};
  for (const line of String(form.get("storage") ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const e = parseStorageEntry(line);
    if (!e) return { error: `Storage entries are key=value. This line didn't parse: ${line}` };
    storage[e[0]] = e[1];
  }
  const responses: FixedResponse[] = [];
  for (const line of String(form.get("responses") ?? "").split("\n").map((l) => l.trim()).filter(Boolean)) {
    const r = parseFixedResponse(line);
    if (!r) return { error: `Fixed responses are "<url> [status] <body>". This line didn't parse: ${line}` };
    responses.push(r);
  }

  const schedule = String(form.get("schedule") ?? "");
  if (schedule && !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule)) return { error: "Pick a time for the daily run." };

  const signing = Signing.safeParse(form.get("signing") ?? app.suite.signing);
  if (!signing.success) return { error: "Choose what the test wallet may sign." };

  const settings: AppSettings = {
    ...app.settings,
    wallets,
    chains,
    funding: funding || undefined,
    allowMainnetLive: false,
    storage,
    responses,
  };
  await updateApp(db(), app.id, (now) => ({
    name,
    url: url.data,
    host: hostOf(url.data),
    settings,
    suite: { ...now.suite, notes: withOwnerHints(now.suite.notes, hints), signing: signing.data },
    scheduleTime: schedule || null,
    ...(liveKey ? { liveKeyEnc: liveKey.enc, liveKeyAddress: liveKey.address } : {}),
    ...(headers ? { accessHeadersEnc: headers.enc, accessHeaderNames: headers.names } : {}),
  }));
  revalidatePath("/", "layout"); // the name shows in the app switcher
  return { ok: "Saved." };
}

export async function deleteAppAction(appId: string): Promise<void> {
  const { app, role } = await requireApp(appId);
  if (!can(role, "apps.manage")) return;
  // Stop anything in flight first; the rows go with the app.
  await db().update(testRuns).set({ stopRequested: true }).where(and(eq(testRuns.appId, app.id), eq(testRuns.status, "running")));
  await db().update(makes).set({ stopRequested: true }).where(and(eq(makes.appId, app.id), inArray(makes.status, ["queued", "running"])));
  await db().delete(apps).where(eq(apps.id, app.id));
  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------- setup and notes

const SetupEdit = z.object({
  startPath: z
    .string()
    .trim()
    .max(500)
    .transform((p) => (p ? (p.startsWith("/") ? p : `/${p}`) : "/")),
  steps: z
    .array(z.string().trim().max(600))
    .transform((s) => s.filter(Boolean))
    .pipe(z.array(z.string()).max(12, "Keep it under 12 lines.")),
});

/**
 * What is done once before the tests, so each starts as a user who is already in. A line whose
 * words didn't change keeps what it recorded; a new one is done by a model, which records it.
 * With no lines the app has no setup, and every test starts from a fresh visit.
 */
export async function saveSetupAction(appId: string, input: z.input<typeof SetupEdit>): Promise<{ error?: string }> {
  const { role } = await requireApp(appId);
  if (!can(role, "apps.manage")) return { error: denied("apps.manage") };
  const e = SetupEdit.safeParse(input);
  if (!e.success) return { error: e.error.issues[0]?.message };
  if (e.data.steps.some(looksLikeKey)) return { error: "A line looks like a private key. Take it out: this text isn't encrypted." };
  await updateApp(db(), appId, ({ suite }) => {
    const old = suite.setup;
    const kept = old?.startPath === e.data.startPath ? [...old.steps] : [];
    const steps = e.data.steps.map((text): Action => {
      const same = kept.findIndex((line) => line.do === text);
      return same >= 0 ? kept.splice(same, 1)[0]! : { type: "action", by: "code", do: text, run: [] };
    });
    const { setup: _gone, ...rest } = suite;
    return { suite: steps.length ? { ...rest, setup: { startPath: e.data.startPath, steps } } : rest };
  });
  revalidatePath(`/apps/${appId}`, "layout");
  return {};
}

/** Takes back something a look or a maker noted about the app, when it is wrong or no longer true. */
export async function removeNoteAction(appId: string, text: string): Promise<void> {
  const { role } = await requireApp(appId);
  if (!can(role, "apps.manage")) return;
  await updateApp(db(), appId, ({ suite }) => ({ suite: { ...suite, notes: suite.notes.filter((n) => n.from === "owner" || n.text !== text) } }));
  revalidatePath(`/apps/${appId}`, "layout");
}
