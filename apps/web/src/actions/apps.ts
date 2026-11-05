"use server";

import {
  KNOWN_CHAINS,
  MAINNET_CHAIN_IDS,
  newId,
  parseFixedResponse,
  keepActions,
  parseStorageEntry,
  SetupWhen,
  WalletProfileId,
  chainInfo,
  type ChainConfig,
  type FixedResponse,
} from "@dappdrill/core";
import { analyses, apps, db, encrypt, testRuns, tests, type AppSettings } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { hostOf } from "@/lib/domains";
import { enqueue } from "@/lib/jobs";
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

/** Starts the first look at an app; the page shows it live. */
async function analyze(appId: string): Promise<void> {
  const running = await db()
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(eq(analyses.appId, appId), inArray(analyses.status, ["queued", "running"])));
  if (running.length) return;
  const id = newId("ana");
  await db().insert(analyses).values({ id, appId });
  await enqueue("analysis.run", { analysisId: id });
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
export async function checkRpcAction(input: string): Promise<{ chainId?: number; error?: string }> {
  await requireUser();
  const url = RpcUrl.safeParse(input);
  if (!url.success) return { error: url.error.issues[0]?.message };
  const chainId = await readChainId(url.data);
  return chainId === undefined ? { error: NO_CHAIN } : { chainId };
}

/**
 * /new: find or create the app for this URL. A new app (or one with no tests yet) gets analyzed.
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
      chains.push({ id, name: info?.name, rpcUrl: rpc.data, mode: (testnet && keyIn) || info?.forkable === false ? "live" : "fork" });
    } else if (chainId) {
      const info = KNOWN_CHAINS.find((c) => c.id === Number(chainId) && c.id !== 31337 && c.forkable);
      if (!info) return { error: "Choose a supported chain." };
      // A key is what opts a testnet into running live. Everything else, mainnets included, is a local fork.
      chains.push({ id: info.id, name: info.name, rpcUrl: info.rpcUrl, mode: info.testnet && keyIn ? "live" : "fork" });
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

  const notes = { ...(hints ? { hints } : {}), ...(funding ? { funding } : {}) };
  const settingsBase: AppSettings = { wallets, chains, ...notes };

  let appId = existing?.id;
  if (!existing) {
    appId = newId("app");
    const host = hostOf(url.data);
    await db()
      .insert(apps)
      .values({ id: appId, organizationId: a.org.id, name: nameFromHost(host), url: url.data, host, settings: settingsBase, ...liveKey });
  } else if (can(a.role, "apps.manage") && (customized || hints || funding || liveKey)) {
    const settings = customized ? { ...existing.settings, ...settingsBase } : { ...existing.settings, ...notes };
    await db()
      .update(apps)
      .set({ settings, ...liveKey })
      .where(eq(apps.id, existing.id));
  }
  const hasTests = existing ? (await db().select({ id: tests.id }).from(tests).where(eq(tests.appId, existing.id)).limit(1)).length > 0 : false;
  if (!hasTests) await analyze(appId!);
  revalidatePath("/", "layout"); // the app switcher lists it
  redirect(`/apps/${appId}`);
}

export async function analyzeAction(appId: string): Promise<void> {
  await requireApp(appId);
  await analyze(appId);
  revalidatePath(`/apps/${appId}`);
}

// ---------------------------------------------------------------- settings

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

  const settings: AppSettings = {
    ...app.settings,
    wallets,
    chains,
    hints: hints || undefined,
    funding: funding || undefined,
    allowMainnetLive: false,
    storage,
    responses,
  };
  await db()
    .update(apps)
    .set({
      name,
      url: url.data,
      host: hostOf(url.data),
      settings,
      scheduleTime: schedule || null,
      ...(liveKey ? { liveKeyEnc: liveKey.enc, liveKeyAddress: liveKey.address } : {}),
      ...(headers ? { accessHeadersEnc: headers.enc, accessHeaderNames: headers.names } : {}),
    })
    .where(eq(apps.id, app.id));
  revalidatePath("/", "layout"); // the name shows in the app switcher
  return { ok: "Saved." };
}

export async function deleteAppAction(appId: string): Promise<void> {
  const { app, role } = await requireApp(appId);
  if (!can(role, "apps.manage")) return;
  // Stop anything in flight first; the rows go with the app.
  await db().update(testRuns).set({ stopRequested: true }).where(and(eq(testRuns.appId, app.id), eq(testRuns.status, "running")));
  await db().update(analyses).set({ stopRequested: true }).where(and(eq(analyses.appId, app.id), eq(analyses.status, "running")));
  await db().delete(apps).where(eq(apps.id, app.id));
  revalidatePath("/", "layout");
  redirect("/");
}

// ---------------------------------------------------------------- setup

const SetupEdit = z.object({
  startPath: z
    .string()
    .trim()
    .transform((p) => (p ? (p.startsWith("/") ? p : `/${p}`) : "/")),
  steps: z
    .array(z.string().trim().max(200))
    .transform((s) => s.filter(Boolean))
    .pipe(z.array(z.string()).min(1, "Add at least one step.").max(12, "Keep it under 12 steps.")),
  when: SetupWhen,
});

/** The steps every test needs first, and when they run. Unchanged steps keep their recorded clicks. */
export async function updateSetupAction(appId: string, input: z.input<typeof SetupEdit>): Promise<{ error?: string }> {
  const { app } = await requireApp(appId);
  const e = SetupEdit.safeParse(input);
  if (!e.success) return { error: e.error.issues[0]?.message };
  const old = app.setup;
  await db()
    .update(apps)
    .set({
      setup: {
        startPath: e.data.startPath,
        steps: keepActions(e.data.steps, old?.startPath === e.data.startPath ? (old?.steps ?? []) : []),
        when: e.data.when,
        // The analysis's reason was for its own pick.
        why: old && old.when === e.data.when ? old.why : undefined,
      },
    })
    .where(eq(apps.id, appId));
  revalidatePath(`/apps/${appId}`, "layout");
  return {};
}

export async function removeSetupAction(appId: string): Promise<void> {
  await requireApp(appId);
  await db().update(apps).set({ setup: null }).where(eq(apps.id, appId));
  revalidatePath(`/apps/${appId}`, "layout");
}
