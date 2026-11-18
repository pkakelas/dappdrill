"use server";

import {
  KNOWN_CHAINS,
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
import { CHAINS } from "@/lib/chains";
import { hostOf } from "@/lib/domains";
import { withOwnerHints } from "@/lib/hints";
import { startMake } from "@/lib/make";
import { readChainId } from "@/lib/rpc";
import { looksLikeKey } from "@/lib/secrets";
import { can, denied } from "@/lib/permissions";
import { orgAccess, requireApp, requireUser } from "@/lib/session";
import { readSite, type SiteInfo } from "@/lib/site";

/** A URL typed without its scheme is https. */
const withScheme = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);

const Url = z
  .string()
  .trim()
  .min(1, "Paste your app's URL.")
  .transform(withScheme)
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

/** The key that holds funds, as its columns keep it (they are named for what it once was): the kept account, or what pays each new one. */
function readKey(input: string): { liveKeyEnc: string; liveKeyAddress: string } | { error: string } {
  const hex = KeyHex.safeParse(input);
  if (!hex.success) return { error: hex.error.issues[0]!.message };
  return { liveKeyEnc: encrypt(hex.data), liveKeyAddress: privateKeyToAccount(hex.data as `0x${string}`).address };
}

const KEY_IN_TEXT = "That looks like a private key. Text boxes aren't encrypted, so take it out.";

const RpcUrl = z
  .string()
  .trim()
  .min(1, "Add the chain's RPC URL.")
  .transform(withScheme)
  .pipe(z.string().url("That doesn't look like a URL."));
const NO_CHAIN = "No chain answered at that URL.";

const Token = z.string().trim().regex(/^0x[0-9a-fA-F]{40}$/, "A token is its contract address: 0x and 40 hex characters.");
const Amount = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "An amount to send is a number, like 0.05 or 100.")
  .refine((a) => Number(a) > 0, "An amount to send is more than zero.");

type Account = Required<Pick<AppSettings, "account" | "fund">>;

/**
 * The account choice as both forms post it, and what each new account is sent: rows of `fundChain`,
 * `fundToken` (empty for the chain's own coin) and `fundAmount`. A row with no amount and no token is skipped.
 */
function readAccount(form: FormData): Account | { error: string } {
  const account = form.get("account") === "kept" ? "kept" : "new";
  const fund: Account["fund"] = [];
  if (account === "kept") return { account, fund };
  const [chains, tokens, amounts] = ["fundChain", "fundToken", "fundAmount"].map((name) => form.getAll(name).map((v) => String(v).trim())) as [string[], string[], string[]];
  for (const [i, amountIn] of amounts.entries()) {
    const tokenIn = tokens[i] ?? "";
    if (!amountIn && !tokenIn) continue;
    const chainId = Number(chains[i]);
    if (!Number.isInteger(chainId) || chainId <= 0) return { error: "Choose the chain for what each new account is sent." };
    const amount = Amount.safeParse(amountIn);
    if (!amount.success) return { error: amount.error.issues[0]!.message };
    const token = tokenIn ? Token.safeParse(tokenIn) : undefined;
    if (token && !token.success) return { error: token.error.issues[0]!.message };
    fund.push({ chainId, ...(token ? { token: token.data } : {}), amount: amount.data });
  }
  return { account, fund };
}

const NO_PAYER = "Add the private key that pays each new account, or take out what to send.";

/** /new: tells the form which chain an RPC belongs to while the user is still typing. */
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
  if (looksLikeKey(hints) || looksLikeKey(funding)) return { error: KEY_IN_TEXT, inline: true };
  const keyIn = String(form.get("fundedKey") ?? "").trim();
  const account = readAccount(form);
  if ("error" in account) return account;
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
      chains.push({ id, name: chainInfo(id)?.name, rpcUrl: rpc.data });
    } else if (chainId) {
      const info = CHAINS.find((c) => c.id === Number(chainId));
      if (!info) return { error: "Choose a supported chain." };
      chains.push({ id: info.id, name: info.name, rpcUrl: info.rpcUrl });
    }
  }

  const [existing] = await db().select().from(apps).where(and(eq(apps.organizationId, a.org.id), eq(apps.url, url.data)));
  const key = keyIn ? readKey(keyIn) : undefined;
  if (key && "error" in key) return key;
  if (account.fund.length > 0 && !key && !existing?.liveKeyEnc) return { error: NO_PAYER };

  const funds = funding ? { funding } : {};
  // On an app that exists, the form's untouched choice (a new account, nothing sent) doesn't replace the saved one.
  const chosen = !existing || key || account.account === "kept" || account.fund.length > 0 ? account : {};
  const settingsBase: AppSettings = { wallets, chains, ...chosen, ...funds };

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
        ...key,
      });
  } else if (can(a.role, "apps.manage") && (customized || hints || funding || key || "account" in chosen)) {
    const settings = customized ? { ...existing.settings, ...settingsBase } : { ...existing.settings, ...chosen, ...funds };
    // The suite is changed as the row holds it now: a make may be writing notes to it.
    await updateApp(db(), existing.id, (now) => ({ settings, ...(hints ? { suite: { ...now.suite, notes: withOwnerHints(now.suite.notes, hints) } } : {}), ...key }));
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
  if (looksLikeKey(hints) || looksLikeKey(funding)) return { error: KEY_IN_TEXT };

  const keyIn = String(form.get("fundedKey") ?? "").trim();
  const removeKey = form.get("removeKey") === "1";
  const account = readAccount(form);
  if ("error" in account) return account;
  if (account.fund.length > 0 && !keyIn && (removeKey || !app.liveKeyEnc)) return { error: NO_PAYER };

  const known = form
    .getAll("chain")
    .map(Number)
    .map((id) => KNOWN_CHAINS.find((c) => c.id === id))
    .filter((c) => c !== undefined)
    .map((c): ChainConfig => ({ id: c.id, name: c.name, rpcUrl: c.rpcUrl }));

  const others: ChainConfig[] = [];
  for (const input of form.getAll("rpcUrl").map(String).filter((s) => s.trim())) {
    const rpc = RpcUrl.safeParse(input);
    if (!rpc.success) return { error: rpc.error.issues[0]?.message };
    // A saved chain doesn't have to answer right now for the rest of the page to save.
    const saved = app.settings.chains.find((c) => c.rpcUrl === rpc.data);
    const id = saved?.id ?? (await readChainId(rpc.data));
    if (id === undefined) return { error: `${NO_CHAIN} ${rpc.data}` };
    others.push({ id, name: chainInfo(id)?.name ?? saved?.name, rpcUrl: rpc.data });
  }

  // One entry per chain, and an RPC the user gave beats ours.
  const chains = [...new Map([...known, ...others].map((c) => [c.id, c])).values()];

  const wallets = form.getAll("wallet").map((w) => WalletProfileId.safeParse(w)).flatMap((r) => (r.success ? [r.data] : []));
  if (wallets.length === 0) return { error: "Pick at least one wallet." };

  const key = keyIn ? readKey(keyIn) : removeKey ? { liveKeyEnc: null, liveKeyAddress: null } : undefined;
  if (key && "error" in key) return key;

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
    ...account,
    funding: funding || undefined,
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
    ...key,
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
 * The setup: what is done once before the tests, so each starts as a user who is already in. Or the
 * reset (`which`): what is done before each test on a kept account, to put it back. A line whose words
 * didn't change keeps its code; a new one isn't code until the next repair writes it. With no lines
 * there is no setup (every test starts from a fresh visit), or no reset.
 */
export async function saveSetupAction(appId: string, input: z.input<typeof SetupEdit>, which: "setup" | "reset" = "setup"): Promise<{ error?: string }> {
  const { role } = await requireApp(appId);
  if (!can(role, "apps.manage")) return { error: denied("apps.manage") };
  const e = SetupEdit.safeParse(input);
  if (!e.success) return { error: e.error.issues[0]?.message };
  if (e.data.steps.some(looksLikeKey)) return { error: "A line looks like a private key. Take it out: this text isn't encrypted." };
  await updateApp(db(), appId, ({ suite }) => {
    const old = suite[which];
    const kept = old?.startPath === e.data.startPath ? [...old.steps] : [];
    const steps = e.data.steps.map((text): Action => {
      const same = kept.findIndex((line) => line.do === text);
      return same >= 0 ? kept.splice(same, 1)[0]! : { type: "action", by: "code", do: text, run: [] };
    });
    const { [which]: _gone, ...rest } = suite;
    return { suite: steps.length ? { ...rest, [which]: { startPath: e.data.startPath, steps } } : rest };
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
