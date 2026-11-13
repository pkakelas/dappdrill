import { eq } from "drizzle-orm";
import type { MakeState, SetupStuck } from "@dappdrill/core";
import { makes, user, type Db } from "@dappdrill/db";
import { config } from "../config.js";
import { errorMessage, logger } from "../log.js";
import type { AppRow } from "../target.js";
import { sendEmail } from "./channels.js";
import type { Alert } from "./compose.js";

const log = logger("notify");
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** How making the tests ended, for the person who started it. One somebody stopped tells nobody. */
export type MakeEnd = "done" | "failed";

/** Why making stopped at the setup, and what puts it right, in a line. */
function stuckLine(stuck: SetupStuck): string {
  if (stuck.fix === "funds") return "Test funds aren't set up for the chain the app runs on, so the wallet couldn't be connected. Add a funded key or say how to get test funds under Settings, then make the tests again.";
  return `The setup didn't finish: ${stuck.reason} Check the setup under Settings, then make the tests again.`;
}

/** What the email says. The counts are the make's own: the tests it kept, and how each stands. */
export function makeAlert(appName: string, end: MakeEnd, state: MakeState | null, link: string): Alert {
  if (end === "failed") return { title: `${appName}: the tests couldn't be made`, lines: ["Something on our side broke, so it ended early. What was made so far is on the app's page."], link };
  const kept = state?.goals.filter((g) => g.status === "kept") ?? [];
  const failing = kept.filter((g) => g.stands === "failed").length;
  const passing = kept.length - failing;
  const none = state?.goals.filter((g) => g.status === "not-kept").length ?? 0;
  const stuck = state?.stuck ? [stuckLine(state.stuck)] : [];
  if (!kept.length) return { title: `${appName}: no tests could be made`, lines: stuck.length ? stuck : [state?.why ?? "None of the goals came to a test that goes the same way twice. Why is on the app's page."], link };
  const lines = [
    ...(passing ? [`${plural(passing, "test")} ${passing === 1 ? "passes" : "pass"} and will run again on every change.`] : []),
    ...(failing ? [`${plural(failing, "test")} ${failing === 1 ? "fails" : "fail"} every time on something the app does wrong.`] : []),
    ...(none ? [`${plural(none, "goal")} got no test. Why is on the app's page.`] : []),
    ...stuck,
  ];
  return { title: `${appName}: ${plural(kept.length, "test")} ready`, lines, link };
}

/** Emails the person who asked for the tests, once making them has ended. */
export async function notifyMake(db: Db, app: AppRow, makeId: string, end: MakeEnd): Promise<void> {
  const [row] = await db.select({ state: makes.state, email: user.email }).from(makes).innerJoin(user, eq(user.id, makes.requestedBy)).where(eq(makes.id, makeId));
  if (!row) return;
  try {
    if (await sendEmail([row.email], makeAlert(app.name, end, row.state, `${config.appUrl}/apps/${app.id}`))) log.info(`emailed ${row.email}: make ${end}`);
  } catch (e) {
    log.warn(`could not email ${row.email} about the tests: ${errorMessage(e)}`);
  }
}
