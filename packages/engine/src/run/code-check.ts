/**
 * A check that code decides, from the page, the wallet and the chain. There is no way to pass one
 * by saying so, and one that can't be made comes back unsure, never as a pass.
 */
import { urlOnApp, type CodeAssert, type CodeCheck, type WalletRequest } from "@dappdrill/core";
import { settle } from "../agent/tools.js";
import { decodeWalletRequest } from "../agent/wallet-decode.js";
import { labelled, noLabel } from "./figures.js";
import { pageText, saidAndGone, saidSince, showsText } from "./page.js";
import { sentHash, signRequests, type Running, type Went } from "./running.js";

const SHOW_WAIT_MS = 5_000;
const BUTTON_WAIT_MS = 3_000;
const TX_WAIT_MS = 15_000;
/** How long a figure gets to catch up with what was done: apps poll the chain every few seconds. */
const CHANGE_WAIT_MS = 20_000;
/** How far a change may be from the one named, beyond the digits the page shows: fees and rounding. */
const CHANGE_TOLERANCE = 0.005;

/** A figure as the page showed it, or why it couldn't be read. */
type Shown = { text: string; value: number };
export type Reading = Shown | { missing: string };

type Found = Pick<Went, "status" | "note">;
const pass = (note: string): Found => ({ status: "pass", note });
const fail = (note: string): Found => ({ status: "fail", note });
const unsure = (note: string): Found => ({ status: "unsure", note });

export async function checkByCode(run: Running, check: CodeCheck): Promise<Went> {
  const found = await decide(run, check.expect).catch((e) => unsure(`The check couldn't be made: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`));
  return { ...found, by: "code" };
}

async function decide(run: Running, expect: CodeAssert): Promise<Found> {
  const { session } = run;
  const { page } = session;
  const signs = signRequests(run);
  switch (expect.kind) {
    case "shows":
      return (await showsText(page, expect.text, SHOW_WAIT_MS)) ? pass(`Shows “${expect.text}”.`) : fail(`“${expect.text}” isn't on the page.`);
    case "hides":
      return (await showsText(page, expect.text, 0)) ? fail(`“${expect.text}” is still on the page.`) : pass(`“${expect.text}” isn't on the page.`);
    case "said":
      return said(run, expect.text);
    case "url":
      return page.url().includes(expect.contains) ? pass(`The address is ${page.url()}.`) : fail(`The address is ${page.url()}, without “${expect.contains}”.`);
    case "button":
      return button(run, expect.name, expect.is);
    case "signed": {
      if (!signs.length) return fail("The wallet wasn't asked to sign anything.");
      const match = signs.find((r) => holds(r, expect.holds));
      return match ? pass(`The wallet was asked: ${decodeWalletRequest(match).summary}.`) : fail(`Nothing the wallet was asked holds “${expect.holds}”. ${asked(signs)}`);
    }
    case "not-signed": {
      const match = expect.holds === undefined ? signs.at(-1) : signs.find((r) => holds(r, expect.holds!));
      if (match) return fail(`The wallet was asked: ${decodeWalletRequest(match).summary}.`);
      return pass(expect.holds === undefined ? "The wallet wasn't asked to sign anything." : `Nothing the wallet was asked holds “${expect.holds}”. ${signs.length ? asked(signs) : "It wasn't asked to sign anything."}`);
    }
    case "mined":
      return mined(run, signs, expect.holds);
    case "changes":
      return changes(run, expect);
  }
}

/** On the page now, or shown since the latest action began and gone again. Waits as `shows` does for one that is late. */
async function said(run: Running, text: string): Promise<Found> {
  const { session } = run;
  const gone = () => saidSince(session, run.acted, text);
  if (await showsText(session.page, text, 0)) return pass(`Shows “${text}”.`);
  if (gone() || (await showsText(session.page, text, SHOW_WAIT_MS)) || gone()) return pass(`The page said “${text}”.`);
  const others = await saidAndGone(session, run.acted, 6);
  return fail(`The page didn't say “${text}”.${others.length ? ` It said: ${others.map((o) => `“${o}”`).join(", ")}.` : ""}`);
}

/** In the request as a person reads it, or in its data: the summary shortens addresses, the data has them whole. */
function holds(r: WalletRequest, what: string): boolean {
  const want = what.toLowerCase();
  if (decodeWalletRequest(r).summary.toLowerCase().includes(want)) return true;
  return (JSON.stringify(r.params) ?? "").toLowerCase().includes(want.replace(/^0x/, ""));
}

const asked = (signs: WalletRequest[]) => `It was asked: ${signs.map((r) => decodeWalletRequest(r).summary).join("; ")}.`;

async function button(run: Running, name: string, want: "enabled" | "disabled"): Promise<Found> {
  const { page } = run.session;
  const named = page.getByRole("button", { name, exact: true }).filter({ visible: true }).first();
  const deadline = Date.now() + BUTTON_WAIT_MS;
  let is: "enabled" | "disabled" | undefined;
  do {
    is = (await named.count()) ? ((await named.isEnabled()) ? "enabled" : "disabled") : undefined;
    if (is === want) return pass(`The “${name}” button is ${is}.`);
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  if (is) return fail(`The “${name}” button is ${is}.`);
  const others = await page.getByRole("button").filter({ visible: true }).allInnerTexts();
  const names = [...new Set(others.map((t) => t.trim()).filter(Boolean))].slice(0, 10);
  return fail(`No “${name}” button on the page.${names.length ? ` The buttons on it: ${names.map((n) => `“${n}”`).join(", ")}.` : ""}`);
}

async function mined(run: Running, signs: WalletRequest[], what?: string): Promise<Found> {
  const wanted = what === undefined ? signs : signs.filter((r) => holds(r, what));
  const sent = wanted.filter(sentHash).at(-1);
  if (!sent) {
    if (wanted.length) return fail(`The wallet was asked, but nothing was sent: ${decodeWalletRequest(wanted.at(-1)!).summary}.`);
    return fail(what === undefined || !signs.length ? "No transaction was sent." : `No transaction that holds “${what}” was sent. ${asked(signs)}`);
  }
  const hash = sentHash(sent)!;
  const receipt = await run.session.chains.client(sent.chainId).waitForTransactionReceipt({ hash, timeout: TX_WAIT_MS });
  const tx = `${decodeWalletRequest(sent).summary} (${hash.slice(0, 10)}…)`;
  return receipt.status === "success" ? pass(`Mined in block ${receipt.blockNumber}: ${tx}.`) : fail(`Reverted in block ${receipt.blockNumber}: ${tx}.`);
}

type Changes = Extract<CodeAssert, { kind: "changes" }>;
const readingKey = (c: Changes) => `${c.on ?? ""}\n${c.figure}`;

async function read(run: Running, figure: string): Promise<Reading> {
  const text = await pageText(run.session.page);
  return labelled(text, figure) ?? { missing: noLabel([figure], text) };
}

async function open(run: Running, path: string): Promise<void> {
  const { session } = run;
  await session.page.goto(urlOnApp(path, session.target.url), { waitUntil: "domcontentloaded" });
  await settle(session);
}

/**
 * Reads every figure the checks will ask about, before the first action. Those on another page are
 * read there, and the browser comes back to where it started.
 */
export async function readBefore(run: Running): Promise<void> {
  const watched = run.steps.flatMap((s) => (s.type === "check" && s.by === "code" && s.expect.kind === "changes" ? [s.expect] : []));
  if (!watched.length) return;
  const start = run.session.page.url();
  for (const c of watched.filter((c) => !c.on)) run.before.set(readingKey(c), await read(run, c.figure));
  const elsewhere = watched.filter((c) => c.on);
  for (const path of new Set(elsewhere.map((c) => c.on!))) {
    await open(run, path);
    for (const c of elsewhere.filter((c) => c.on === path)) run.before.set(readingKey(c), await read(run, c.figure));
  }
  if (elsewhere.length) await open(run, start);
}

/**
 * The first check whose figure couldn't be read before the test began, and why. That check can't be
 * decided whatever is done, so nothing is: on an account that is kept, doing it would only move it.
 */
export function unreadBefore(run: Running): { line: number; note: string } | undefined {
  for (const [line, s] of run.steps.entries()) {
    if (s.type !== "check" || s.by !== "code" || s.expect.kind !== "changes") continue;
    const before = run.before.get(readingKey(s.expect));
    if (before && "missing" in before) return { line, note: beforeNote(s.expect, before.missing) };
  }
}

const beforeNote = (c: Changes, missing: string) => `Before the test began${c.on ? `, on ${c.on}` : ""}: ${missing}`;

/** Whether a figure moved by what was named, give or take one unit of the last digit shown and half a percent. */
export function movedBy(before: Shown, now: Shown, by: number): boolean {
  const digits = now.text.split(".")[1]?.replace(/\D/g, "").length ?? 0;
  const slack = Math.max(10 ** -digits, Math.abs(by) * CHANGE_TOLERANCE);
  return Math.abs(now.value - before.value - by) <= slack + 1e-9;
}

async function changes(run: Running, expect: Changes): Promise<Found> {
  const before = run.before.get(readingKey(expect));
  if (!before || "missing" in before) return unsure(beforeNote(expect, before?.missing ?? `“${expect.figure}” wasn't read.`));
  const by = Number(expect.by);
  if (!Number.isFinite(by)) return unsure(`“${expect.by}” isn't a number.`);
  if (expect.on) await open(run, expect.on);
  const deadline = Date.now() + CHANGE_WAIT_MS;
  let now: Reading;
  do {
    now = await read(run, expect.figure);
    if (!("missing" in now) && movedBy(before, now, by)) return pass(`“${expect.figure}” went from ${before.text} to ${now.text}.`);
    await run.session.page.waitForTimeout(500);
  } while (Date.now() < deadline);
  if ("missing" in now) return unsure(now.missing);
  const moved = Number((now.value - before.value).toPrecision(10));
  return fail(`“${expect.figure}” went from ${before.text} to ${now.text}: a change of ${moved}, not ${by}.`);
}
