"use server";

import { newId } from "@dappdrill/core";
import { apiTokens, db, domains, encrypt, integrations, invites, sha256, teamMembers, testWallets } from "@dappdrill/db";
import { and, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { checkDomain, HOST_RE } from "@/lib/domains";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { currentTeam, requireApp } from "@/lib/session";

const Id = z.string().min(1).max(100);
const done = (ok: string): ActionResult => {
  revalidatePath("/account");
  return { ok };
};

// ---------------------------------------------------------------- test inbox

const MAILTM = "https://api.mail.tm";

/** Creates a disposable mail.tm inbox for embedded-wallet email-code logins. */
export async function createInboxAction(_prev?: ActionResult, _form?: FormData): Promise<ActionResult> {
  const { team } = await currentTeam();
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
    await db().update(testWallets).set({ inboxAddress: address, inboxPasswordEnc: encrypt(password) }).where(eq(testWallets.teamId, team.id));
  } catch {
    return { error: "Couldn't reach the inbox service. Try again in a minute." };
  }
  return done("Inbox created.");
}

export async function removeInboxAction(): Promise<void> {
  const { team } = await currentTeam();
  await db().update(testWallets).set({ inboxAddress: null, inboxPasswordEnc: null }).where(eq(testWallets.teamId, team.id));
  revalidatePath("/account");
}

// ---------------------------------------------------------------- domains

export async function addDomainAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { team } = await currentTeam();
  let host = String(form.get("host") ?? "").trim().toLowerCase();
  try {
    if (host.includes("/")) host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    // validated below
  }
  if (!HOST_RE.test(host)) return { error: "Enter a hostname, like app.example.com." };
  const [existing] = await db().select({ id: domains.id }).from(domains).where(and(eq(domains.teamId, team.id), eq(domains.host, host)));
  if (existing) return { error: `${host} is already on the list.` };
  await db().insert(domains).values({ id: newId("dom"), teamId: team.id, host, token: randomBytes(12).toString("hex") });
  return done(`Added ${host}. Publish the token below, then press Verify.`);
}

async function teamDomain(domainId: string) {
  const { team } = await currentTeam();
  const [row] = await db().select().from(domains).where(and(eq(domains.id, Id.parse(domainId)), eq(domains.teamId, team.id)));
  return row;
}

export async function verifyDomainAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const row = await teamDomain(String(form.get("domainId")));
  if (!row) return { error: "Domain not found." };
  const method = await checkDomain(row.host, row.token);
  if (!method) return { error: `Didn't find the token at https://${row.host}/.well-known/dappdrill.txt or in a TXT record yet. DNS can take a few minutes.` };
  await db().update(domains).set({ verifiedAt: new Date(), method }).where(eq(domains.id, row.id));
  return done(`${row.host} is verified.`);
}

export async function removeDomainAction(form: FormData): Promise<void> {
  const row = await teamDomain(String(form.get("domainId")));
  if (row) await db().delete(domains).where(eq(domains.id, row.id));
  revalidatePath("/account");
}

// ---------------------------------------------------------------- integrations
// Contract with the worker: slack secret = webhook URL; telegram secret = bot token, config.chatId;
// email config.to (comma-separated); github config.repo ("owner/name").

const Kind = z.enum(["slack", "telegram", "email", "github"]);
const emails = z
  .string()
  .trim()
  .transform((s) => s.split(/[\s,]+/).filter(Boolean))
  .pipe(z.array(z.string().email("One of those isn't an email address.")).min(1, "Add at least one email address.").max(20));

export async function saveIntegrationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { team } = await currentTeam();
  const kind = Kind.parse(form.get("kind"));
  const [existing] = await db().select().from(integrations).where(and(eq(integrations.teamId, team.id), eq(integrations.kind, kind)));
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
  } else if (kind === "email") {
    const parsed = emails.safeParse(String(form.get("to") ?? ""));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message };
    config = { to: parsed.data.join(", ") };
    secret = null;
  } else {
    const repo = String(form.get("repo") ?? "").trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$|\/$/g, "");
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { error: "Use owner/name, like harborvault/app." };
    config = { repo };
    secret = null;
  }

  const values = { config, enabled: true, ...(secret !== undefined ? { secretEnc: secret ? encrypt(secret) : null } : {}) };
  if (existing) await db().update(integrations).set(values).where(eq(integrations.id, existing.id));
  else await db().insert(integrations).values({ id: newId("int"), teamId: team.id, kind, ...values });
  return done("Saved.");
}

export async function setIntegrationEnabledAction(form: FormData): Promise<void> {
  const { team } = await currentTeam();
  const kind = Kind.parse(form.get("kind"));
  await db()
    .update(integrations)
    .set({ enabled: form.get("enabled") === "1" })
    .where(and(eq(integrations.teamId, team.id), eq(integrations.kind, kind)));
  revalidatePath("/account");
}

export async function removeIntegrationAction(form: FormData): Promise<void> {
  const { team } = await currentTeam();
  const kind = Kind.parse(form.get("kind"));
  await db().delete(integrations).where(and(eq(integrations.teamId, team.id), eq(integrations.kind, kind)));
  revalidatePath("/account");
}

// ---------------------------------------------------------------- API tokens

export async function createTokenAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { app } = await requireApp(Id.parse(form.get("appId")));
  const name = z.string().trim().min(1, "Name the token, e.g. GitHub Action.").max(60).safeParse(form.get("name"));
  if (!name.success) return { error: name.error.issues[0]?.message };
  const token = `ddt_${randomBytes(24).toString("base64url")}`;
  await db().insert(apiTokens).values({ id: newId("tok"), appId: app.id, name: name.data, tokenHash: sha256(token) });
  revalidatePath("/account");
  return { ok: "Copy it now. You won't see it again.", secret: token };
}

export async function revokeTokenAction(form: FormData): Promise<void> {
  const id = Id.parse(form.get("tokenId"));
  const [row] = await db().select({ appId: apiTokens.appId }).from(apiTokens).where(eq(apiTokens.id, id));
  if (!row) return;
  await requireApp(row.appId);
  await db().delete(apiTokens).where(eq(apiTokens.id, id));
  revalidatePath("/account");
}

// ---------------------------------------------------------------- team

export async function inviteAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { team, role, user } = await currentTeam();
  if (role !== "owner") return { error: "Only owners can invite people." };
  const email = z.string().trim().toLowerCase().email().safeParse(form.get("email"));
  if (!email.success) return { error: "Enter an email address." };
  const token = randomBytes(24).toString("base64url");
  await db().insert(invites).values({ id: newId("inv"), teamId: team.id, email: email.data, token, invitedBy: user.id });
  const link = `${env.appUrl}/invite/${token}`;
  await sendEmail({
    to: email.data,
    subject: `${user.name || user.email} invited you to ${team.name} on DappDrill`,
    text: `${user.name || user.email} invited you to join ${team.name} on DappDrill.\n\nAccept the invite: ${link}\n`,
  });
  revalidatePath("/account");
  return { ok: `Invite sent to ${email.data}. You can also share this link:`, secret: link };
}

export async function cancelInviteAction(form: FormData): Promise<void> {
  const { team, role } = await currentTeam();
  if (role !== "owner") return;
  await db().delete(invites).where(and(eq(invites.id, Id.parse(form.get("inviteId"))), eq(invites.teamId, team.id)));
  revalidatePath("/account");
}

export async function removeMemberAction(form: FormData): Promise<void> {
  const { team, role, user } = await currentTeam();
  const userId = Id.parse(form.get("userId"));
  if (role !== "owner" || userId === user.id) return;
  await db().delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  revalidatePath("/account");
}
