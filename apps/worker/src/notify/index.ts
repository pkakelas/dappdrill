import { and, desc, eq, inArray, isNotNull, lt, notInArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { conditionInfo } from "@dappdrill/core";
import { decrypt, flows, integrations, teamMembers, testRuns, tests, user, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import type { AppRow } from "../target.js";
import { sendEmail, sendSlack, sendTelegram } from "./channels.js";
import { composeAlert, type Alert, type Regression } from "./compose.js";

const log = logger("notify");
const base = alias(tests, "base");

/** After a batch: tell the team about tests that failed now and passed the time before. */
export async function notifyRegressions(db: Db, app: AppRow, runIds: string[]): Promise<Alert | null> {
  if (runIds.length === 0) return null;
  const failed = await db
    .select({ testId: testRuns.testId, createdAt: testRuns.createdAt, result: testRuns.result, testName: tests.name, baseName: base.name, condition: tests.condition, flowName: flows.name })
    .from(testRuns)
    .innerJoin(tests, eq(tests.id, testRuns.testId))
    .leftJoin(base, eq(base.id, tests.baseId))
    .innerJoin(flows, eq(flows.id, tests.flowId))
    .where(and(inArray(testRuns.id, runIds), eq(testRuns.status, "fail")));

  const regressions: Regression[] = [];
  for (const run of failed) {
    const [previous] = await db
      .select({ status: testRuns.status })
      .from(testRuns)
      .where(and(eq(testRuns.testId, run.testId), notInArray(testRuns.id, runIds), lt(testRuns.createdAt, run.createdAt), isNotNull(testRuns.finishedAt), inArray(testRuns.status, ["pass", "fail"])))
      .orderBy(desc(testRuns.createdAt))
      .limit(1);
    if (previous?.status === "pass") {
      // A condition row is named "Flow · Test · Condition", like everywhere else.
      regressions.push({ testName: run.baseName ?? run.testName, flowName: run.flowName, condition: run.condition ? conditionInfo(run.condition).name : undefined, failure: run.result?.failure });
    }
  }

  const alert = composeAlert({ appName: app.name, regressions, link: `${config.appUrl}/apps/${app.id}` });
  if (!alert) return null;

  const rows = await db.select().from(integrations).where(and(eq(integrations.teamId, app.teamId), eq(integrations.enabled, true)));
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
          const to = await emailRecipients(db, app.teamId, row.config);
          if (to.length === 0) throw new Error("no recipients");
          await sendEmail(to, alert);
          break;
        }
        default:
          continue;
      }
      log.info(`${row.kind}: sent "${alert.title}"`);
    } catch (e) {
      log.warn(`${row.kind}: could not send: ${errorMessage(e)}`);
    }
  }
  return alert;
}

/** config.to (comma-separated), else every member of the team. */
async function emailRecipients(db: Db, teamId: string, cfg: Record<string, string>): Promise<string[]> {
  const listed = (cfg.to ?? cfg.recipients ?? "").split(/[,\s]+/).filter(Boolean);
  if (listed.length) return listed;
  const members = await db.select({ email: user.email }).from(teamMembers).innerJoin(user, eq(user.id, teamMembers.userId)).where(eq(teamMembers.teamId, teamId));
  return members.map((m) => m.email);
}
