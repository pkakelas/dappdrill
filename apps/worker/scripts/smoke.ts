/**
 * End-to-end smoke test of the worker against the fake engine and the real database.
 *
 *   corepack pnpm --filter @dappdrill/worker smoke
 *
 * Seeds a throwaway team/app (names start with "smoke-"), starts the worker as a child process,
 * drives scan.run / stop / schedule.tick → batch.run / flow-change.run through pg-boss, checks the
 * rows, and checks the alerts reach a local HTTP listener standing in for Slack and Telegram.
 * Everything it created is deleted at the end, pass or fail.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { and, count, eq, inArray } from "drizzle-orm";
import { newId, type EdgeCaseId } from "@dappdrill/core";
import {
  apps,
  createDb,
  encrypt,
  flowChanges,
  flows,
  integrations,
  issues,
  repairs,
  runBatches,
  runs,
  scanEvents,
  scans,
  signingReviews,
  teamMembers,
  teams,
  testWallets,
  user,
  type AppSettings,
} from "@dappdrill/db";
import { artifactsDir } from "../src/artifacts.js";
import { createBoss, QUEUES } from "../src/queues.js";

const db = createDb();
const tag = `smoke-${randomBytes(3).toString("hex")}`;
const ids = { team: newId("team"), user: newId("user"), app: newId("app") };
const edgeCases: EdgeCaseId[] = ["happy", "reject", "wrong-network"];
const created: { scans: string[]; batches: string[]; changes: string[] } = { scans: [], batches: [], changes: [] };
let failures = 0;

function check(ok: boolean, what: string) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
}

async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, timeoutMs = 120_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Stand-in for Slack and Telegram.
const received: { path: string; body: any }[] = [];
const hook = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ path: req.url ?? "", body: JSON.parse(body || "null") });
    res.end("ok");
  });
});
await new Promise<void>((r) => hook.listen(0, "127.0.0.1", r));
const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}`;

const worker = spawn(process.execPath, ["--import", "tsx", "--env-file=../../.env", "src/main.ts"], {
  cwd: new URL("..", import.meta.url).pathname,
  env: {
    ...process.env,
    DAPPDRILL_FAKE_ENGINE: "1",
    DAPPDRILL_FAKE_DELAY_MS: "60",
    DAPPDRILL_STOP_POLL_MS: "300",
    DAPPDRILL_DEV: "1",
    TELEGRAM_API_URL: hookUrl,
    SMTP_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
const workerLog: string[] = [];
for (const s of [worker.stdout, worker.stderr]) s.on("data", (d: Buffer) => workerLog.push(...d.toString().trimEnd().split("\n")));

const boss = await createBoss();

async function scanRow(id: string) {
  return (await db.select().from(scans).where(eq(scans.id, id)))[0]!;
}
async function startScan(number: number): Promise<string> {
  const id = newId("scan");
  const [app] = await db.select().from(apps).where(eq(apps.id, ids.app));
  await db.insert(scans).values({ id, appId: ids.app, number, settings: app!.settings });
  created.scans.push(id);
  await boss.send(QUEUES.scan, { scanId: id });
  return id;
}
const countWhere = async (table: typeof runs | typeof issues | typeof signingReviews | typeof flows, col: any, id: string) =>
  (await db.select({ n: count() }).from(table).where(eq(col, id)))[0]!.n;

try {
  console.log(`seeding ${tag}; hooks on ${hookUrl}`);
  const settings: AppSettings = { edgeCases, wallets: ["metamask"], chains: [] };
  await db.insert(user).values({ id: ids.user, name: tag, email: `${tag}@example.invalid` });
  await db.insert(teams).values({ id: ids.team, name: tag });
  await db.insert(teamMembers).values({ teamId: ids.team, userId: ids.user, role: "owner" });
  const key = () => encrypt(`0x${randomBytes(32).toString("hex")}`);
  await db.insert(testWallets).values({
    teamId: ids.team,
    accountAKeyEnc: key(),
    accountAAddress: "0x00000000000000000000000000000000000000aa",
    accountBKeyEnc: key(),
    accountBAddress: "0x00000000000000000000000000000000000000bb",
  });
  await db.insert(apps).values({ id: ids.app, teamId: ids.team, name: `${tag} Harbor`, url: "http://localhost:4999", host: "localhost", settings });
  await db.insert(integrations).values([
    { id: newId("int"), teamId: ids.team, kind: "slack", secretEnc: encrypt(`${hookUrl}/slack`) },
    { id: newId("int"), teamId: ids.team, kind: "telegram", config: { chatId: "42" }, secretEnc: encrypt("smoke-bot-token") },
    { id: newId("int"), teamId: ids.team, kind: "email", config: { to: `${tag}@example.invalid` } },
  ]);

  console.log("\n1. scan.run persists everything");
  const scan1 = await startScan(1);
  const s1 = await waitFor("scan 1", async () => {
    const s = await scanRow(scan1);
    return s.status === "done" || s.status === "failed" ? s : undefined;
  });
  check(s1.status === "done", `scan finished: ${s1.status}${s1.error ? ` (${s1.error})` : ""}`);
  const nEvents = (await db.select({ n: count() }).from(scanEvents).where(eq(scanEvents.scanId, scan1)))[0]!.n;
  const nFlows = await countWhere(flows, flows.scanId, scan1);
  const nRuns = await countWhere(runs, runs.scanId, scan1);
  const nIssues = await countWhere(issues, issues.scanId, scan1);
  const nReviews = await countWhere(signingReviews, signingReviews.scanId, scan1);
  console.log(`     ${nEvents} events, ${nFlows} flows, ${nRuns} runs, ${nIssues} issues, ${nReviews} signing reviews`);
  check(nEvents > 50 && nFlows === 4 && nRuns === 4 * edgeCases.length && nIssues >= 3 && nReviews >= 3, "rows landed");
  check(Object.values(s1.stages).every((st) => st?.status === "done") && Object.keys(s1.stages).length >= 4, `stages: ${Object.keys(s1.stages).join(", ")}`);
  check(s1.pages.length >= 3 && s1.chains.length > 0 && !!s1.walletAddress && !!s1.liveFrame && s1.costUsd > 0, "pages, chains, wallet, live frame and cost set");
  check(!!s1.startedAt && !!s1.finishedAt, "timestamps set");
  const slackAfterScan = await waitFor("slack alert", async () => received.filter((r) => r.path === "/slack").length || undefined, 10_000).catch(() => 0);
  check(slackAfterScan === 1, `Slack got the scan alert: "${received.find((r) => r.path === "/slack")?.body?.text}"`);
  check(received.some((r) => r.path === "/botsmoke-bot-token/sendMessage" && r.body.chat_id === "42"), "Telegram got it too");

  console.log("\n2. stop");
  const scan2 = await startScan(2);
  await waitFor("scan 2 running", async () => (await scanRow(scan2)).status === "running");
  await new Promise((r) => setTimeout(r, 500));
  await db.update(scans).set({ stopRequested: true }).where(eq(scans.id, scan2));
  const s2 = await waitFor("scan 2 stopped", async () => {
    const s = await scanRow(scan2);
    return s.status !== "running" && s.status !== "queued" ? s : undefined;
  }, 15_000);
  check(s2.status === "stopped" && !!s2.finishedAt && s2.error === null, `stopped: ${s2.status}`);

  console.log("\n3. schedule.tick → batch.run with repairs");
  // "This is expected" on one medium issue from scan 1, to check it stays ignored later.
  const [medium] = await db.select().from(issues).where(and(eq(issues.scanId, scan1), eq(issues.severity, "medium")));
  await db.update(issues).set({ status: "ignored" }).where(eq(issues.id, medium!.id));
  await db.update(apps).set({ scheduleTime: "03:33" }).where(eq(apps.id, ids.app));
  const slackBefore = received.filter((r) => r.path === "/slack").length;
  await boss.send(QUEUES.scheduleTick, { at: "03:33" });
  const batch = await waitFor("scheduled batch", async () => (await db.select().from(runBatches).where(eq(runBatches.appId, ids.app)))[0]);
  created.batches.push(batch.id);
  check(batch.trigger === "schedule" && batch.request.flowIds.length === 4 && batch.request.edgeCases.join() === edgeCases.join(), "batch row created with all flows and the app's edge cases");
  const b = await waitFor("batch done", async () => {
    const [r] = await db.select().from(runBatches).where(eq(runBatches.id, batch.id));
    return r && (r.status === "done" || r.status === "failed") ? r : undefined;
  });
  check(b.status === "done", `batch finished: ${b.status}${b.error ? ` (${b.error})` : ""}`);
  const bRuns = await db.select().from(runs).where(eq(runs.batchId, batch.id));
  const bIssues = await countWhere(issues, issues.batchId, batch.id);
  const bRepairs = await db.select().from(repairs).where(eq(repairs.flowId, bRuns.find((r) => r.status === "fail" && r.edgeCase === "happy")?.flowId ?? "-"));
  console.log(`     ${bRuns.length} runs (${bRuns.filter((r) => r.status === "fail").length} failed), ${bIssues} issues, ${bRepairs.length} repairs`);
  check(bRuns.length === 4 * edgeCases.length && bIssues > 0, "runs and issues stored with batch_id");
  check(bRepairs.length === 1 && bRepairs[0]!.status === "open" && !JSON.stringify(bRepairs[0]!.proposed).includes("Withdraw all"), `repair proposed: ${bRepairs[0]?.explanation}`);
  await waitFor("batch alert", async () => received.filter((r) => r.path === "/slack").length > slackBefore, 10_000).catch(() => false);
  const batchAlert = received.filter((r) => r.path === "/slack").at(-1)?.body;
  check(received.filter((r) => r.path === "/slack").length === slackBefore + 1, `Slack got the run alert: "${batchAlert?.text}"`);
  check(JSON.stringify(batchAlert).includes("Broke: Withdraw"), "alert names the flow that went from passing to broken");
  await boss.send(QUEUES.scheduleTick, { at: "03:33" });
  await new Promise((r) => setTimeout(r, 2000));
  check((await db.select().from(runBatches).where(eq(runBatches.appId, ids.app))).length === 1, "a second tick in the same window doesn't double-schedule");

  console.log("\n4. flow-change.run");
  const [withdraw] = await db.select().from(flows).where(and(eq(flows.appId, ids.app), eq(flows.name, "Withdraw")));
  const changes = [
    { id: newId("chg"), appId: ids.app, flowId: withdraw?.id ?? null, kind: "describe" as const, prompt: "Also check the balance goes to zero" },
    { id: newId("chg"), appId: ids.app, flowId: null, kind: "describe" as const, prompt: "Claim staking rewards" },
  ];
  await db.insert(flowChanges).values(changes);
  created.changes.push(...changes.map((c) => c.id));
  for (const c of changes) await boss.send(QUEUES.flowChange, { changeId: c.id });
  const done = await waitFor("flow changes", async () => {
    const rows = await db.select().from(flowChanges).where(inArray(flowChanges.id, created.changes));
    return rows.every((r) => r.status === "done" || r.status === "failed") ? rows : undefined;
  });
  for (const r of done) check(r.status === "done" && !!r.proposed && !!r.explanation, `${r.flowId ? "edit" : "new"}: ${r.status}, ${r.proposed?.steps.length} steps: "${r.explanation}"`);
  check(done.find((r) => r.flowId)?.proposed?.id === withdraw?.id, "an edit keeps the flow's id");

  console.log("\n5. a repeat scan: ignored stays ignored, nothing new to alert about");
  const slackBefore3 = received.filter((r) => r.path === "/slack").length;
  const scan3 = await startScan(3);
  const s3 = await waitFor("scan 3", async () => {
    const s = await scanRow(scan3);
    return s.status === "done" || s.status === "failed" ? s : undefined;
  });
  check(s3.status === "done", `scan finished: ${s3.status}`);
  const [again] = await db.select().from(issues).where(and(eq(issues.scanId, scan3), eq(issues.fingerprint, medium!.fingerprint)));
  check(again?.status === "ignored", `same-fingerprint issue stored as ${again?.status}`);
  await new Promise((r) => setTimeout(r, 1500));
  check(received.filter((r) => r.path === "/slack").length === slackBefore3, "no Slack alert for problems already reported");
  check(workerLog.some((l) => l.includes("[notify]") && l.includes("email")), "email without SMTP_URL is logged");

  console.log("\n6. graceful shutdown mid-scan");
  const scan4 = await startScan(4);
  await waitFor("scan 4 running", async () => (await scanRow(scan4)).status === "running");
  await new Promise((r) => setTimeout(r, 300));
  worker.kill("SIGTERM");
  await new Promise((r) => worker.once("exit", r));
  const s4 = await scanRow(scan4);
  check(s4.status === "failed" && s4.error === "The worker shut down during the scan." && worker.exitCode === 0, `${s4.status}: ${s4.error}; worker exit code ${worker.exitCode}`);
} catch (e) {
  failures++;
  console.error("FAIL", e);
} finally {
  console.log("\ncleaning up");
  await boss.stop({ graceful: false }).catch(() => {});
  if (worker.exitCode === null && worker.signalCode === null) {
    worker.kill("SIGTERM");
    await new Promise((r) => worker.once("exit", r));
  }
  await db.delete(teams).where(eq(teams.id, ids.team)); // cascades to apps, scans, flows, runs, issues, batches, ...
  await db.delete(user).where(eq(user.id, ids.user));
  for (const id of created.scans) await rm(artifactsDir("scans", id), { recursive: true, force: true });
  for (const id of created.batches) await rm(artifactsDir("batches", id), { recursive: true, force: true });
  for (const id of created.changes) await rm(artifactsDir("flow-changes", id), { recursive: true, force: true });
  hook.close();
  const tail = workerLog.filter((l) => /stopping|stopped|ready/.test(l));
  console.log(tail.map((l) => `  worker: ${l}`).join("\n"));
  if (process.env.SMOKE_VERBOSE) console.log(workerLog.join("\n"));
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}
