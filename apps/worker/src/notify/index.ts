import { and, desc, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { conditionInfo } from "@dappdrill/core";
import { decrypt, integrations, member, signingAlerts, testRuns, tests, user, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import type { AppRow } from "../target.js";
import { sendEmail, sendSlack, sendTelegram } from "./channels.js";
import { composeAlert, newDangerous, type Alert, type Regression } from "./compose.js";

const log = logger("notify");
const base = alias(tests, "base");

/**
 * After a batch: tell the organization about tests that failed now and passed the time before,
 * and about Dangerous signatures it hasn't heard about yet, whatever the test's own status.
 */
export async function notifyBatch(db: Db, app: AppRow, runIds: string[]): Promise<Alert | null> {
  if (runIds.length === 0) return null;
  const results = await db
    .select({ testId: testRuns.testId, status: testRuns.status, createdAt: testRuns.createdAt, result: testRuns.result, testName: tests.name, baseName: base.name, condition: tests.condition })
    .from(testRuns)
    .innerJoin(tests, eq(tests.id, testRuns.testId))
    .leftJoin(base, eq(base.id, tests.baseId))
    .where(inArray(testRuns.id, runIds));

  // A condition row is named "Test · Condition", like everywhere else.
  const placeOf = (run: (typeof results)[number]) => ({ testName: run.baseName ?? run.testName, condition: run.condition ? conditionInfo(run.condition).name : undefined });

  const regressions: Regression[] = [];
  for (const run of results.filter((r) => r.status === "fail")) {
    const [previous] = await db
      .select({ status: testRuns.status })
      .from(testRuns)
      .where(and(eq(testRuns.testId, run.testId), notInArray(testRuns.id, runIds), lt(testRuns.createdAt, run.createdAt), isNotNull(testRuns.finishedAt), inArray(testRuns.status, ["pass", "fail"])))
      .orderBy(desc(testRuns.createdAt))
      .limit(1);
    if (previous?.status === "pass") regressions.push({ ...placeOf(run), failure: run.result?.failure });
  }

  const told = await db.select({ key: signingAlerts.key }).from(signingAlerts).where(eq(signingAlerts.appId, app.id));
  const dangerous = newDangerous(
    results.map((r) => ({ ...placeOf(r), reviews: r.result?.signingReviews ?? [] })),
    new Set(told.map((t) => t.key)),
  );

  const alert = composeAlert({ appName: app.name, regressions, dangerous, link: `${config.appUrl}/apps/${app.id}` });
  if (!alert) return null;

  let delivered = false;
  const rows = await db.select().from(integrations).where(and(eq(integrations.organizationId, app.organizationId), eq(integrations.enabled, true)));
  for (const row of rows) {
    try {
      const secret = row.secretEnc ? decrypt(row.secretEnc) : undefined;
      switch (row.kind) {
        case "slack":
          if (!secret) throw new Error("no webhook URL");
          await sendSlack(secret, alert);
          break;
        case "telegram": {
          const chatId = row.config.chatId ?? row.config.chat_id;
          if (!secret || !chatId) throw new Error("needs a bot token and a chat id");
          await sendTelegram(secret, chatId, alert);
          break;
        }
        case "email": {
          const to = await emailRecipients(db, app.organizationId, row.config);
          if (to.length === 0) throw new Error("no recipients");
          if (!(await sendEmail(to, alert))) continue;
          break;
        }
        default:
          continue;
      }
      delivered = true;
      log.info(`${row.kind}: sent "${alert.title}"`);
    } catch (e) {
      log.warn(`${row.kind}: could not send: ${errorMessage(e)}`);
    }
  }
  // Only once someone was told: with no channel working, the next run tries again.
  if (delivered && dangerous.length > 0) {
    await db.insert(signingAlerts).values(dangerous.map((d) => ({ appId: app.id, key: d.key }))).onConflictDoNothing();
  }
  return alert;
}

/** config.to (comma-separated), else everyone in the organization. */
async function emailRecipients(db: Db, orgId: string, cfg: Record<string, string>): Promise<string[]> {
  const listed = (cfg.to ?? cfg.recipients ?? "").split(/[,\s]+/).filter(Boolean);
  if (listed.length) return listed;
  const members = await db.select({ email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, orgId));
  return members.map((m) => m.email);
}
