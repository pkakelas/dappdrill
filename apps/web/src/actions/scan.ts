"use server";

import { chainInfo, ChainConfig, EdgeCaseId, MAINNET_CHAIN_IDS, WalletProfileId } from "@dappdrill/core";
import { apps, db, encrypt, scans, type AppSettings } from "@dappdrill/db";
import { newId } from "@dappdrill/core";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import { hostOf } from "@/lib/domains";
import { startScan } from "@/lib/launch";
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
  };
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

  const settings: AppSettings = {
    edgeCases: input.edgeCases,
    wallets: input.wallets,
    chains,
    hints: input.hints || undefined,
    allowMainnetLive: input.allowMainnetLive,
  };
  const liveKey = input.liveKey
    ? { liveKeyEnc: encrypt(input.liveKey), liveKeyAddress: privateKeyToAccount(input.liveKey as `0x${string}`).address }
    : input.removeLiveKey
      ? { liveKeyEnc: null, liveKeyAddress: null }
      : {};

  // From app settings: "Save" stores the settings without scanning.
  const saveOnly = form.get("intent") === "save" && app;
  if (app && !saveOnly) {
    const allowance = await scanAllowance(app.id, team.plan);
    if (allowance.left <= 0) {
      return { error: `You've used all ${allowance.limit} discovery scans for ${app.name} this month (${PLANS[team.plan].name} plan). Replays are still unlimited.` };
    }
  }
  if (app) {
    [app] = await db()
      .update(apps)
      .set({ url: input.url, host: hostOf(input.url), settings, ...liveKey })
      .where(eq(apps.id, app.id))
      .returning();
  } else {
    const host = hostOf(input.url);
    [app] = await db()
      .insert(apps)
      .values({ id: newId("app"), teamId: team.id, name: nameFromHost(new URL(input.url).host), url: input.url, host, settings, ...liveKey })
      .returning();
  }

  revalidatePath("/", "layout");
  if (saveOnly) return { ok: "Saved. The next scan uses these settings." };
  const scanId = await startScan(app!, user.id);
  redirect(`/apps/${app!.id}/scans/${scanId}`);
}

/** Scans an app again with its saved settings (the header's Scan button). */
export async function rescanAction(form: FormData): Promise<void> {
  const { app, user } = await requireApp(z.string().min(1).parse(form.get("appId")));
  const { team } = await currentTeam();
  const allowance = await scanAllowance(app.id, team.plan);
  if (allowance.left <= 0) {
    const error = `You've used all ${allowance.limit} discovery scans for ${app.name} this month. Replays are still unlimited.`;
    redirect(`/apps/${app.id}/settings?error=${encodeURIComponent(error)}`);
  }
  const scanId = await startScan(app, user.id);
  revalidatePath("/", "layout");
  redirect(`/apps/${app.id}/scans/${scanId}`);
}

export async function stopScanAction(scanId: string): Promise<void> {
  const id = z.string().min(1).parse(scanId);
  const [scan] = await db().select({ appId: scans.appId }).from(scans).where(eq(scans.id, id));
  if (!scan) return;
  await requireApp(scan.appId);
  await db().update(scans).set({ stopRequested: true }).where(eq(scans.id, id));
}
