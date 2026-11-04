"use server";

import { newId } from "@dappdrill/core";
import { agentMessages, db, type AgentLink } from "@dappdrill/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { enqueue } from "@/lib/jobs";
import { requireApp } from "@/lib/session";

export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  status: "pending" | "done" | "failed";
  links: AgentLink[];
}

/** The conversation for the side panel, oldest first. */
export async function agentMessagesAction(appId: string): Promise<AgentMessage[]> {
  await requireApp(appId);
  return db()
    .select({ id: agentMessages.id, role: agentMessages.role, text: agentMessages.text, status: agentMessages.status, links: agentMessages.links })
    .from(agentMessages)
    .where(eq(agentMessages.appId, appId))
    .orderBy(asc(agentMessages.createdAt))
    .limit(200);
}

/** The user's message and a pending reply the worker fills in. */
export async function sendAgentMessageAction(appId: string, text: string, context: { testId?: string }): Promise<{ error?: string }> {
  const { user } = await requireApp(appId);
  const clean = text.trim().slice(0, 4000);
  if (!clean) return {};
  const pending = await db()
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(and(eq(agentMessages.appId, appId), eq(agentMessages.status, "pending")));
  if (pending.length) return { error: "Wait for the answer first." };
  const now = Date.now();
  const replyId = newId("msg");
  await db()
    .insert(agentMessages)
    .values([
      { id: newId("msg"), appId, userId: user.id, role: "user", text: clean, context, createdAt: new Date(now) },
      { id: replyId, appId, role: "agent", status: "pending", context, createdAt: new Date(now + 1) },
    ]);
  await enqueue("agent.reply", { messageId: replyId });
  return {};
}

export async function clearAgentAction(appId: string): Promise<void> {
  await requireApp(appId);
  await db()
    .delete(agentMessages)
    .where(and(eq(agentMessages.appId, appId), inArray(agentMessages.status, ["done", "failed"])));
}
