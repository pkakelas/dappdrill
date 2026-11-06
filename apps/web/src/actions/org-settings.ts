"use server";

import { newId } from "@dappdrill/core";
import { db, domains, encrypt, integrations, testWallets } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { checkDomain, HOST_RE } from "@/lib/domains";
import { orgAccess } from "@/lib/session";

const Id = z.string().min(1).max(100);
const done = (ok: string): ActionResult => {
  revalidatePath("/organization");
  return { ok };
};

/** The organization the form names (a hidden orgId field), for people who may change its settings. */
const access = (form: FormData) => orgAccess(form.get("orgId"), "org.manage");

// ---------------------------------------------------------------- test inbox

const MAILTM = "https://api.mail.tm";

/** Creates a disposable mail.tm inbox for embedded-wallet email-code logins. */
export async function createInboxAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await access(form);
  if ("error" in a) return a;
  try {
    const res = await fetch(`${MAILTM}/domains`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    const body = (await res.json()) as { "hydra:member"?: { domain: string; isActive?: boolean }[] } | { domain: string }[];
    const list = Array.isArray(body) ? body : (body["hydra:member"] ?? []);
    const domain = list.find((d) => (d as { isActive?: boolean }).isActive !== false)?.domain;
    if (!domain) return { error: "The inbox service has no domains available right now. Try again later." };
    const address = `dd-${randomBytes(5).toString("hex")}@${domain}`;
    const password = randomBytes(18).toString("base64url");
    const created = await fetch(`${MAILTM}/accounts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address, password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!created.ok) return { error: `The inbox service said no (${created.status}). Try again in a minute.` };
    await db().update(testWallets).set({ inboxAddress: address, inboxPasswordEnc: encrypt(password) }).where(eq(testWallets.organizationId, a.org.id));
  } catch {
    return { error: "Couldn't reach the inbox service. Try again in a minute." };
  }
  return done("Inbox created.");
}

export async function removeInboxAction(orgId: string): Promise<{ error?: string }> {
  const a = await orgAccess(orgId, "org.manage");
  if ("error" in a) return a;
  await db().update(testWallets).set({ inboxAddress: null, inboxPasswordEnc: null }).where(eq(testWallets.organizationId, a.org.id));
  revalidatePath("/organization");
  return {};
}

// ---------------------------------------------------------------- domains

export async function addDomainAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await access(form);
  if ("error" in a) return a;
  let host = String(form.get("host") ?? "").trim().toLowerCase();
  try {
    if (host.includes("/")) host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    // validated below
  }
  if (!HOST_RE.test(host)) return { error: "Enter a hostname, like app.example.com." };
  const [existing] = await db().select({ id: domains.id }).from(domains).where(and(eq(domains.organizationId, a.org.id), eq(domains.host, host)));
  if (existing) return { error: `${host} is already on the list.` };
  await db().insert(domains).values({ id: newId("dom"), organizationId: a.org.id, host, token: randomBytes(12).toString("hex") });
  return done(`Added ${host}. Publish its token, then press Verify.`);
}

async function orgDomain(orgId: unknown, domainId: unknown) {
  const a = await orgAccess(orgId, "org.manage");
  if ("error" in a) return undefined;
  const [row] = await db().select().from(domains).where(and(eq(domains.id, Id.parse(domainId)), eq(domains.organizationId, a.org.id)));
  return row;
}

export async function verifyDomainAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const row = await orgDomain(form.get("orgId"), form.get("domainId"));
  if (!row) return { error: "Domain not found." };
  const method = await checkDomain(row.host, row.token);
  if (!method) return { error: `Didn't find the token at https://${row.host}/.well-known/dappdrill.txt or in a TXT record yet. DNS can take a few minutes.` };
  await db().update(domains).set({ verifiedAt: new Date(), method }).where(eq(domains.id, row.id));
  return done(`${row.host} is verified.`);
}

export async function removeDomainAction(orgId: string, domainId: string): Promise<{ error?: string }> {
  const row = await orgDomain(orgId, domainId);
  if (row) await db().delete(domains).where(eq(domains.id, row.id));
  revalidatePath("/organization");
  return {};
}

// ---------------------------------------------------------------- integrations
// Contract with the worker: slack secret = webhook URL; telegram secret = bot token, config.chatId;
// email config.to (comma-separated).

const Kind = z.enum(["slack", "telegram", "email"]);
const emails = z
  .string()
  .trim()
  .transform((s) => s.split(/[\s,]+/).filter(Boolean))
  .pipe(z.array(z.string().email("One of those isn't an email address.")).min(1, "Add at least one email address.").max(20));

export async function saveIntegrationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const a = await access(form);
  if ("error" in a) return a;
  const kind = Kind.parse(form.get("kind"));
  const [existing] = await db().select().from(integrations).where(and(eq(integrations.organizationId, a.org.id), eq(integrations.kind, kind)));
  const secretIn = String(form.get("secret") ?? "").trim();
  let config: Record<string, string> = {};
  let secret: string | null | undefined; // undefined = keep the stored one

  if (kind === "slack") {
    if (secretIn) {
      if (!/^https:\/\/hooks\.slack\.com\/services\/\S+$/.test(secretIn)) return { error: "Paste the Incoming Webhook URL, starting with https://hooks.slack.com/services/." };
      secret = secretIn;
    } else if (!existing?.secretEnc) return { error: "Paste the webhook URL." };
    const channel = String(form.get("channel") ?? "").trim();
    if (channel) config.channel = channel.startsWith("#") ? channel : `#${channel}`;
  } else if (kind === "telegram") {
    if (secretIn) {
      if (!/^\d+:[\w-]{20,}$/.test(secretIn)) return { error: "That doesn't look like a bot token (123456:ABC…)." };
      secret = secretIn;
    } else if (!existing?.secretEnc) return { error: "Paste the bot token from @BotFather." };
    const chatId = String(form.get("chatId") ?? "").trim();
    if (!/^-?\d+$|^@\w+$/.test(chatId)) return { error: "Chat id is a number like -1001234567890, or @channelname." };
    config = { chatId };
  } else {
    const parsed = emails.safeParse(String(form.get("to") ?? ""));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    config = { to: parsed.data.join(", ") };
    secret = null;
  }

  const values = { config, enabled: true, ...(secret !== undefined ? { secretEnc: secret ? encrypt(secret) : null } : {}) };
  if (existing) await db().update(integrations).set(values).where(eq(integrations.id, existing.id));
  else await db().insert(integrations).values({ id: newId("int"), organizationId: a.org.id, kind, ...values });
  return done("Saved.");
}

export async function setIntegrationEnabledAction(form: FormData): Promise<void> {
  const a = await access(form);
  if ("error" in a) return;
  const kind = Kind.parse(form.get("kind"));
  await db()
    .update(integrations)
    .set({ enabled: form.get("enabled") === "1" })
    .where(and(eq(integrations.organizationId, a.org.id), eq(integrations.kind, kind)));
  revalidatePath("/organization");
}

export async function removeIntegrationAction(orgId: string, kind: string): Promise<{ error?: string }> {
  const a = await orgAccess(orgId, "org.manage");
  if ("error" in a) return a;
  await db().delete(integrations).where(and(eq(integrations.organizationId, a.org.id), eq(integrations.kind, Kind.parse(kind))));
  revalidatePath("/organization");
  return {};
}
