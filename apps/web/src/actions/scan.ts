"use server";

import { chainInfo, ChainConfig, EdgeCaseId, MAINNET_CHAIN_IDS, parseFixedResponse, parseStorageEntry, WalletProfileId } from "@dappdrill/core";
import { apps, db, encrypt, scans, type AppSettings } from "@dappdrill/db";
import { newId } from "@dappdrill/core";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { hostOf } from "@/lib/domains";
import { startRetry, startScan } from "@/lib/launch";
import { PLANS, scanAllowance } from "@/lib/plan";
import { currentTeam, requireApp } from "@/lib/session";

export type FormState = { error?: string; ok?: string } | undefined;

const KeyHex = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "The funded key must be a 0x-prefixed 32-byte hex private key.");

const NewScanInput = z.object({
  url: z
    .string()
    .trim()
    .min(1, "Paste your dApp's URL.")
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.string().url("That doesn't look like a URL.")),
  appId: z.string().optional(),
  chainMode: z.enum(["auto", "pick"]).default("auto"),
  chains: z.array(z.coerce.number().int()).default([]),
  customChainId: z.union([z.literal(""), z.coerce.number().int().positive()]).optional(),
  customRpc: z.union([z.literal(""), z.string().url("The custom RPC must be a URL.")]).optional(),
  customLive: z.boolean().default(false),
  wallets: z.array(WalletProfileId).min(1, "Pick at least one wallet."),
  edgeCases: z.array(EdgeCaseId).min(1, "Pick at least one edge case."),
  liveKey: z.union([z.literal(""), KeyHex]).optional(),
  removeLiveKey: z.boolean().default(false),
  allowMainnetLive: z.boolean().default(false),
  hints: z.string().trim().max(2000).optional(),
  accessHeaderName: z.union([z.literal(""), z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/, "The header name can only use letters, digits and - (like x-dappdrill-token).")]).optional(),
  accessHeaderValue: z.string().max(2000).optional(),
  removeAccessHeaders: z.boolean().default(false),
  storage: z.string().max(4000).default(""),
  responses: z.string().max(20000).default(""),
});

function readForm(form: FormData) {
  return {
    url: form.get("url"),
    appId: form.get("appId") || undefined,
    chainMode: form.get("chainMode") || undefined,
    chains: form.getAll("chains"),
    customChainId: form.get("customChainId") ?? undefined,
    customRpc: form.get("customRpc") ?? undefined,
    customLive: form.get("customLive") === "on",
    wallets: form.getAll("wallets"),
    edgeCases: form.getAll("edgeCases"),
    liveKey: String(form.get("liveKey") ?? "").trim(),
    removeLiveKey: form.get("removeLiveKey") === "on",
    allowMainnetLive: form.get("allowMainnetLive") === "on",
    hints: form.get("hints") ?? undefined,
    accessHeaderName: String(form.get("accessHeaderName") ?? "").trim(),
    accessHeaderValue: String(form.get("accessHeaderValue") ?? "").trim(),
    removeAccessHeaders: form.get("removeAccessHeaders") === "on",
    storage: form.get("storage") ?? undefined,
    responses: form.get("responses") ?? undefined,
  };
}

/** The form's test-setup lines; the first line that doesn't parse is the error. */
function parseSetup(storageText: string, responsesText: string): Pick<AppSettings, "storage" | "responses"> | { error: string } {
  const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);
  const storage: Record<string, string> = {};
  for (const line of lines(storageText)) {
    const entry = parseStorageEntry(line);
    if (!entry) return { error: `Browser storage lines look like key=value; "${line.slice(0, 60)}" doesn't.` };
    storage[entry[0]] = entry[1];
  }
  const responses = [];
  for (const line of lines(responsesText)) {
    const r = parseFixedResponse(line);
    if (!r || !/^https?:\/\//i.test(r.url)) return { error: `Fixed responses look like "https://… [status] body"; "${line.slice(0, 60)}" doesn't.` };
    responses.push(r);
  }
  return { storage: Object.keys(storage).length ? storage : undefined, responses: responses.length ? responses : undefined };
}

function nameFromHost(host: string): string {
  const parts = host.replace(/^(www|app|staging|beta)\./, "").split(".");
  const base = parts[0] ?? host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export async function startScanAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = NewScanInput.safeParse(readForm(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  const input = parsed.data;
  const { user, team } = await currentTeam();

  const chains: ChainConfig[] = [];
  if (input.chainMode === "pick") {
    for (const id of input.chains) {
      const info = chainInfo(id);
      if (info) chains.push({ id, name: info.name, rpcUrl: info.rpcUrl, mode: info.forkable ? "fork" : "live" });
    }
    if (input.customChainId && input.customRpc) {
      // A known chain entered here gets this RPC instead of the default one.
      const known = chains.findIndex((c) => c.id === input.customChainId);
      if (known >= 0) chains.splice(known, 1);
      chains.push({ id: input.customChainId, rpcUrl: input.customRpc, mode: input.customLive ? "live" : "fork" });
    } else if (input.customChainId || input.customRpc) {
      return { error: "A custom chain needs both a chain ID and an RPC URL." };
    }
    if (chains.length === 0) return { error: "Pick at least one chain, or let us detect them." };
  }

  const liveChains = chains.filter((c) => c.mode === "live");
  const mainnetLive = liveChains.filter((c) => MAINNET_CHAIN_IDS.has(c.id));
  if (mainnetLive.length && !input.allowMainnetLive) {
    return { error: `Live mode on ${mainnetLive.map((c) => c.name ?? c.id).join(", ")} would use real funds. Turn on "Allow mainnet in live mode" if you mean it.` };
  }

  // Find or create the app.
  let app = input.appId ? (await requireApp(input.appId)).app : undefined;
  if (!app) {
    [app] = await db().select().from(apps).where(and(eq(apps.teamId, team.id), eq(apps.url, input.url)));
  }
  if (liveChains.length && !input.liveKey && !(app?.liveKeyEnc && !input.removeLiveKey)) {
    return { error: "Chains in live mode need a funded test key." };
  }

  const setup = parseSetup(input.storage, input.responses);
  if ("error" in setup) return setup;

  const settings: AppSettings = {
    edgeCases: input.edgeCases,
    wallets: input.wallets,
    chains,
    hints: input.hints || undefined,
    allowMainnetLive: input.allowMainnetLive,
    ...setup,
  };
  const liveKey = input.liveKey
    ? { liveKeyEnc: encrypt(input.liveKey), liveKeyAddress: privateKeyToAccount(input.liveKey as `0x${string}`).address }
    : input.removeLiveKey
      ? { liveKeyEnc: null, liveKeyAddress: null }
      : {};

  if (Boolean(input.accessHeaderName) !== Boolean(input.accessHeaderValue)) {
    return { error: "The bot-protection header needs both a name and a secret value." };
  }
  // A new header replaces what's stored; values are never shown again.
  const access = input.accessHeaderName
    ? { accessHeadersEnc: encrypt(JSON.stringify({ [input.accessHeaderName.toLowerCase()]: input.accessHeaderValue })), accessHeaderNames: [input.accessHeaderName.toLowerCase()] }
    : input.removeAccessHeaders
      ? { accessHeadersEnc: null, accessHeaderNames: [] }
      : {};

  if (app) {
    const allowance = await scanAllowance(app.id, team.plan);
    if (allowance.left <= 0) {
      return { error: `You've used all ${allowance.limit} discovery scans for ${app.name} this month (${PLANS[team.plan].name} plan). Replays are still unlimited.` };
    }
    [app] = await db()
      .update(apps)
      .set({ url: input.url, host: hostOf(input.url), settings, ...liveKey, ...access })
      .where(eq(apps.id, app.id))
      .returning();
  } else {
    const host = hostOf(input.url);
    [app] = await db()
      .insert(apps)
      .values({ id: newId("app"), teamId: team.id, name: nameFromHost(new URL(input.url).host), url: input.url, host, settings, ...liveKey, ...access })
      .returning();
  }

  const scanId = await startScan(app!, user.id);
  revalidatePath("/", "layout");
  redirect(`/apps/${app!.id}/scans/${scanId}`);
}

export async function stopScanAction(scanId: string): Promise<void> {
  const id = z.string().min(1).parse(scanId);
  const [scan] = await db().select({ appId: scans.appId }).from(scans).where(eq(scans.id, id));
  if (!scan) return;
  await requireApp(scan.appId);
  await db().update(scans).set({ stopRequested: true }).where(eq(scans.id, id));
}

const PlanRef = z.object({ scanId: z.string().min(1), name: z.string().min(1).max(200) });

async function plannedFlow(form: FormData) {
  const { scanId, name } = PlanRef.parse({ scanId: form.get("scanId"), name: form.get("name") });
  const [scan] = await db().select({ appId: scans.appId, plan: scans.plan }).from(scans).where(eq(scans.id, scanId));
  if (!scan?.plan?.items.some((i) => i.name === name)) throw new Error("Planned flow not found");
  const { app, user } = await requireApp(scan.appId);
  return { app, user, scanId, name };
}

/** Records a planned flow again; the hint is optional. */
export async function retryPlannedAction(_prev: FormState, form: FormData): Promise<FormState> {
  const { app, user, scanId, name } = await plannedFlow(form);
  const hint = String(form.get("hint") ?? "").trim().slice(0, 1000);
  await startRetry(app.id, scanId, name, hint, user.id);
  revalidatePath(`/apps/${app.id}/scans/${scanId}`);
  return { ok: "Trying again." };
}

/** Leaves a planned flow out of future scans, or brings it back. */
export async function skipPlannedAction(form: FormData): Promise<void> {
  const { app, scanId, name } = await plannedFlow(form);
  const skip = new Set(app.settings.skipFlows ?? []);
  if (form.get("undo") === "1") skip.delete(name);
  else skip.add(name);
  await db().update(apps).set({ settings: { ...app.settings, skipFlows: [...skip] } }).where(eq(apps.id, app.id));
  revalidatePath(`/apps/${app.id}/scans/${scanId}`);
}
