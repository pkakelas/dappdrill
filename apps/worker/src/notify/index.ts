import { and, desc, eq, notInArray } from "drizzle-orm";
import type { Blocked, FlowRun, Issue } from "@dappdrill/core";
import { renderMarkdown, type ReportInput } from "@dappdrill/cli";
import { decrypt, integrations, runs, teamMembers, user, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import { isNewFingerprint, type Persister } from "../persist.js";
import type { AppRow } from "../target.js";
import { sendEmail, sendSlack, sendTelegram } from "./channels.js";
import { composeAlert, composeScanDone, type Alert, type Regression } from "./compose.js";

const log = logger("notify");

export interface NotifyInput {
  app: AppRow;
  what: "scan" | "scheduled run" | "run";
  /** Path under APP_URL, e.g. /apps/<id>/scans/<id>. */
  path: string;
  persister: Persister;
  report: ReportInput;
}

/**
 * After a scan or batch: alert the team about new Broken issues and flows that went from passing to broken.
 * Returns the alert (null when there was nothing to say) and who it was emailed to.
 */
export async function notifyAfter(db: Db, input: NotifyInput): Promise<{ alert: Alert | null; emailed: string[] }> {
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
  const emailed: string[] = [];
  if (!alert) return { alert, emailed };

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
          emailed.push(...to);
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
  return { alert, emailed };
}

/** Email whoever started a scan when it ends, whatever it found, unless an alert already reached them. */
export async function notifyScanDone(
  db: Db,
  input: NotifyInput & { scan: { number: number; triggeredBy: string | null; blocked: Blocked | null }; error: string | null; failed: boolean; emailed: string[] },
): Promise<void> {
  if (!input.scan.triggeredBy) return;
  const [person] = await db.select({ email: user.email }).from(user).where(eq(user.id, input.scan.triggeredBy));
  if (!person || input.emailed.some((to) => to.toLowerCase() === person.email.toLowerCase())) return;

  const { persister, report } = input;
  const alert = composeScanDone({
    appName: input.app.name,
    number: input.scan.number,
    failed: input.failed,
    error: input.error,
    blocked: input.scan.blocked,
    issues: [...persister.written.issues.values()].filter((i) => !persister.ignored.has(i.id)),
    runs: [...persister.written.runs.values()],
    flows: report.flows,
    link: `${config.appUrl}${input.path}`,
  });
  await sendEmail([person.email], alert, input.failed ? "" : renderMarkdown(report, { title: input.app.name, link: alert.link }));
  log.info(`email: told ${person.email} "${alert.title}"`);
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
