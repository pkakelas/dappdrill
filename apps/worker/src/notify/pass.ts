import { eq } from "drizzle-orm";
import type { ExploreState } from "@dappdrill/core";
import { explorations, user, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import type { AppRow } from "../target.js";
import { sendEmail } from "./channels.js";
import type { Alert } from "./compose.js";

const log = logger("notify");
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** How a pass ended, for the person who started it. A pass somebody stopped tells nobody. */
export type PassEnd = "done" | "asked" | "failed";

/** What the email says. The counts come from the pass itself: tests it saved, bugs it confirmed. */
export function passAlert(appName: string, end: PassEnd, state: ExploreState | null, link: string): Alert {
  if (end === "asked") return { title: `${appName}: the tests need your input`, lines: [`${state?.needs?.name ?? "A chain"} can't be forked, so tests need an account with test funds there. Say how to get them, or give a funded key, on the app's page.`], link };
  if (end === "failed") return { title: `${appName}: the tests couldn't be written`, lines: ["Something on our side broke, so the pass ended early. What it found so far is on the app's page."], link };
  const tests = state?.suggested.filter((s) => s.status === "proved").length ?? 0;
  const bugs = state?.bugs.filter((b) => b.status === "confirmed").length ?? 0;
  // A test written from a bug is saved already, failing until the bug is fixed; what is left is the drafts.
  const left = state?.suggested.filter((s) => s.status !== "proved" && s.status !== "bug").length ?? 0;
  const lines = [
    tests ? `${plural(tests, "test")} passed and will run again on every change.` : "No test passed on its own yet.",
    ...(bugs ? [`${plural(bugs, "bug")} found.`] : []),
    ...(left ? [`${plural(left, "more test")} to look at: add the ones you want from the app's page.`] : []),
  ];
  return { title: tests ? `${appName}: ${plural(tests, "test")} ready` : `${appName}: done exploring`, lines, link };
}

/** Emails the person who started the pass, once it has ended. */
export async function notifyPass(db: Db, app: AppRow, explorationId: string, end: PassEnd): Promise<void> {
  const [row] = await db.select({ state: explorations.state, email: user.email }).from(explorations).innerJoin(user, eq(user.id, explorations.requestedBy)).where(eq(explorations.id, explorationId));
  if (!row) return;
  try {
    if (await sendEmail([row.email], passAlert(app.name, end, row.state, `${config.appUrl}/apps/${app.id}`))) log.info(`emailed ${row.email}: pass ${end}`);
  } catch (e) {
    log.warn(`could not email ${row.email} about the pass: ${errorMessage(e)}`);
  }
}
