import { and, desc, eq, notInArray } from "drizzle-orm";
import type { FlowRun, Issue } from "@dappdrill/core";
import { renderMarkdown, type ReportInput } from "@dappdrill/cli";
import { decrypt, integrations, runs, teamMembers, user, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import { isNewFingerprint, type Persister } from "../persist.js";
import type { AppRow } from "../target.js";
import { sendEmail, sendSlack, sendTelegram } from "./channels.js";
import { composeAlert, type Alert, type Regression } from "./compose.js";

const log = logger("notify");

export interface NotifyInput {
  app: AppRow;
  what: "scan" | "scheduled run" | "run";
  /** Path under APP_URL, e.g. /apps/<id>/scans/<id>. */
  path: string;
  persister: Persister;
  report: ReportInput;
}

/** After a scan or batch: alert the team about new Broken issues and flows that went from passing to broken. */
export async function notifyAfter(db: Db, input: NotifyInput): Promise<Alert | null> {
  const { app, persister } = input;
  const issues = [...persister.written.issues.values()];
  const runList = [...persister.written.runs.values()];

  const newIssues: Issue[] = [];
  for (const issue of issues) {
    if (issue.severity !== "critical" && issue.severity !== "high") continue;
    if (persister.ignored.has(issue.id)) continue;
    if (newIssues.some((i) => i.fingerprint === issue.fingerprint)) continue;
    if (await isNewFingerprint(db, app.id, issue.fingerprint, issues.map((i) => i.id))) newIssues.push(issue);
  }
  const regressions = await findRegressions(db, runList, input);

  const alert = composeAlert({ appName: app.name, what: input.what, newIssues, regressions, link: `${config.appUrl}${input.path}` });
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
          await sendEmail(to, alert, renderMarkdown(input.report, { title: app.name, link: alert.link }));
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

/** Runs that broke now where the previous run of the same flow and edge case passed. */
async function findRegressions(db: Db, current: FlowRun[], input: NotifyInput): Promise<Regression[]> {
  const out: Regression[] = [];
  const ids = current.map((r) => r.id);
  for (const run of current) {
    if (run.status !== "fail") continue;
    const [previous] = await db
      .select({ status: runs.status })
      .from(runs)
      .where(and(eq(runs.flowId, run.flowId), eq(runs.edgeCase, run.edgeCase), notInArray(runs.id, ids)))
      .orderBy(desc(runs.createdAt))
      .limit(1);
    if (previous && (previous.status === "pass" || previous.status === "issue")) {
      const flowName = input.report.flows.find((f) => f.id === run.flowId)?.name ?? run.flowId;
      out.push({ flowName, edgeCase: run.edgeCase });
    }
  }
  return out;
}

/** config.to (comma-separated), else every member of the team. */
async function emailRecipients(db: Db, teamId: string, cfg: Record<string, string>): Promise<string[]> {
  const listed = (cfg.to ?? cfg.recipients ?? "").split(/[,\s]+/).filter(Boolean);
  if (listed.length) return listed;
  const members = await db.select({ email: user.email }).from(teamMembers).innerJoin(user, eq(user.id, teamMembers.userId)).where(eq(teamMembers.teamId, teamId));
  return members.map((m) => m.email);
}
