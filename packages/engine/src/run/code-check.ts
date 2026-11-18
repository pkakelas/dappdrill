/**
 * A check, decided by code from the page, the wallet and the chain. There is no way to pass one by
 * saying so. One that couldn't read what it needs comes back unsure, never as a pass or a fail.
 */
import { urlOnApp, type CodeAssert, type CodeCheck, type FigureSide, type PageFigure, type WalletRequest } from "@dappdrill/core";
import { settle } from "../agent/tools.js";
import { decodeWalletRequest } from "../agent/wallet-decode.js";
import { readColumn, rowsHolding } from "../replay/rows.js";
import { figureIn, labelled, noLabel, rawError, unitOf, type Shown } from "./figures.js";
import { pageText, placeOf, reads, saidAndGone, saidSince, showsText, textsIn, type Where } from "./page.js";
import { sentHash, signRequests, type Running, type Went } from "./running.js";

/** How often a check that waits reads the page again. */
const POLL_MS = 250;
/** Seconds a kind keeps looking when its line doesn't say: see `wait` in core. Apps poll the chain every few seconds, so a figure gets longest. */
const WAIT_S: Partial<Record<CodeAssert["kind"], number>> = { shows: 5, said: 5, figures: 5, button: 3, changes: 20, mined: 15 };
/** How far a change may be from the one named, beyond the digits the page shows: fees and rounding. */
const CHANGE_TOLERANCE = 0.005;

/** A figure as the page showed it, or why it couldn't be read. */
export type Reading = Shown | { missing: string };

type Found = Pick<Went, "status" | "note">;
const pass = (note: string): Found => ({ status: "pass", note });
const fail = (note: string): Found => ({ status: "fail", note });
const unsure = (note: string): Found => ({ status: "unsure", note });

export async function checkByCode(run: Running, check: CodeCheck): Promise<Went> {
  const found = await decide(run, check.expect).catch((e) => unsure(`The check couldn't be made: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`));
  return { ...found, by: "code" };
}

/** A group's parts, or the assertion itself. */
const parts = (expect: CodeAssert): CodeAssert[] => (expect.kind === "any" || expect.kind === "all" ? expect.of.flatMap(parts) : [expect]);

const waitOf = (expect: CodeAssert): number => expect.wait ?? Math.max(...parts(expect).map((p) => p.wait ?? WAIT_S[p.kind] ?? 0));

/** Reads the assertion again until it passes or its time is up. The last reading stands. */
async function decide(run: Running, expect: CodeAssert): Promise<Found> {
  if (expect.kind === "changes" && expect.on) await open(run, expect.on);
  const deadline = Date.now() + waitOf(expect) * 1000;
  for (;;) {
    const found = await once(run, expect, deadline);
    if (found.status === "pass" || Date.now() >= deadline) return found;
    await run.session.page.waitForTimeout(POLL_MS);
  }
}

/** The assertion as things stand at this moment. */
async function once(run: Running, expect: CodeAssert, deadline: number): Promise<Found> {
  const { page } = run.session;
  const latest = (expect.kind === "signed" || expect.kind === "not-signed") && expect.latest === true;
  const signs = signRequests(run, latest);
  switch (expect.kind) {
    case "shows":
    case "hides":
      return shown(run, expect);
    case "said":
      return said(run, expect.text);
    case "url":
      return page.url().includes(expect.contains) ? pass(`The address is ${page.url()}.`) : fail(`The address is ${page.url()}, without “${expect.contains}”.`);
    case "button":
      return button(run, expect);
    case "signed": {
      if (!signs.length) return fail("The wallet wasn't asked to sign anything.");
      const holding = signs.filter((r) => holds(r, expect.holds));
      if (!holding.length) return fail(`Nothing the wallet was asked holds “${expect.holds}”. ${asked(signs)}`);
      const match = expect.was ? holding.find((r) => r.outcome === expect.was) : holding[0];
      if (match) return pass(`The wallet was asked${expect.was ? `, and it was ${expect.was}` : ""}: ${decodeWalletRequest(match).summary}.`);
      return fail(`The wallet was asked, and it was ${holding.at(-1)!.outcome}, not ${expect.was}: ${decodeWalletRequest(holding.at(-1)!).summary}.`);
    }
    case "not-signed": {
      const match = expect.holds === undefined ? signs.at(-1) : signs.find((r) => holds(r, expect.holds!));
      if (match) return fail(`The wallet was asked: ${decodeWalletRequest(match).summary}.`);
      return pass(expect.holds === undefined ? "The wallet wasn't asked to sign anything." : `Nothing the wallet was asked holds “${expect.holds}”. ${signs.length ? asked(signs) : "It wasn't asked to sign anything."}`);
    }
    case "mined":
      return mined(run, signs, expect.holds, deadline);
    case "changes":
      return changes(run, expect);
    case "figures":
      return figures(run, expect);
    case "no-error":
      return noError(run, expect);
    case "any":
    case "all": {
      const found: Found[] = [];
      for (const part of expect.of) found.push(await once(run, part, deadline));
      return expect.kind === "any" ? anyOf(found) : allOf(found);
    }
  }
}

/** One that holds is enough. With none, it failed only when every one did. */
function anyOf(found: Found[]): Found {
  const held = found.find((f) => f.status === "pass");
  if (held) return held;
  const notes = found.map((f) => f.note).join(" ");
  return found.every((f) => f.status === "fail") ? fail(`None of them holds. ${notes}`) : unsure(notes);
}

/** The first that fails decides it; else the first that couldn't be told. */
function allOf(found: Found[]): Found {
  return found.find((f) => f.status === "fail") ?? found.find((f) => f.status !== "pass") ?? pass(found.map((f) => f.note).join(" "));
}

const inPlace = (where: Where) => (where.row !== undefined ? ` in the row with “${where.row}”` : where.dialog ? " in the dialog" : " on the page");

async function shown(run: Running, expect: Extract<CodeAssert, { kind: "shows" | "hides" }>): Promise<Found> {
  const { page } = run.session;
  const wants = expect.kind === "shows";
  let there: boolean;
  if (expect.row === undefined && !expect.dialog) there = await showsText(page, expect.text, 0);
  else {
    const place = await placeOf(page, expect);
    // Nothing is shown where there is nothing: a row that is gone hides whatever it said.
    if ("missing" in place) return wants ? fail(place.missing) : pass(place.missing);
    there = (await textsIn(place)).some((text) => reads(text, expect.text));
  }
  const note = there ? `Shows “${expect.text}”${inPlace(expect)}.` : `“${expect.text}” isn't${inPlace(expect)}.`;
  return there === wants ? pass(note) : fail(note);
}

/** On the page now, or shown since the latest action began and gone again. */
async function said(run: Running, text: string): Promise<Found> {
  const { session } = run;
  if (await showsText(session.page, text, 0)) return pass(`Shows “${text}”.`);
  if (saidSince(session, run.acted, text)) return pass(`The page said “${text}”.`);
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

/** A button by its name, else a link, else anything that reads exactly so: what a user would press. */
async function button(run: Running, expect: Extract<CodeAssert, { kind: "button" }>): Promise<Found> {
  const { name } = expect;
  const place = await placeOf(run.session.page, expect);
  if ("missing" in place) return fail(place.missing);
  const scope = place.rows ?? place.root;
  for (const named of [scope.getByRole("button", { name, exact: true }), scope.getByRole("link", { name, exact: true }), scope.getByText(name, { exact: true })]) {
    const control = named.filter({ visible: true }).first();
    if (!(await control.count())) continue;
    const is = (await control.isEnabled()) ? "enabled" : "disabled";
    const note = `“${name}”${inPlace(expect)} is ${is}.`;
    return is === expect.is ? pass(note) : fail(note);
  }
  const others = await scope.getByRole("button").filter({ visible: true }).allInnerTexts();
  const names = [...new Set(others.map((t) => t.trim()).filter(Boolean))].slice(0, 10);
  return fail(`No “${name}”${inPlace(expect)}.${names.length ? ` The buttons there: ${names.map((n) => `“${n}”`).join(", ")}.` : ""}`);
}

async function mined(run: Running, signs: WalletRequest[], what: string | undefined, deadline: number): Promise<Found> {
  const wanted = what === undefined ? signs : signs.filter((r) => holds(r, what));
  const sent = wanted.filter(sentHash).at(-1);
  if (!sent) {
    if (wanted.length) return fail(`The wallet was asked, but nothing was sent: ${decodeWalletRequest(wanted.at(-1)!).summary}.`);
    return fail(what === undefined || !signs.length ? "No transaction was sent." : `No transaction that holds “${what}” was sent. ${asked(signs)}`);
  }
  const hash = sentHash(sent)!;
  const tx = `${decodeWalletRequest(sent).summary} (${hash.slice(0, 10)}…)`;
  const receipt = await run.session.chains
    .client(sent.chainId)
    .waitForTransactionReceipt({ hash, timeout: Math.max(deadline - Date.now(), 1_000) })
    .catch(() => undefined);
  if (!receipt) return unsure(`Not mined yet: ${tx}.`);
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

const watched = (run: Running): Changes[] => run.steps.flatMap((s) => (s.type === "check" && s.by === "code" ? parts(s.expect).filter((p): p is Changes => p.kind === "changes") : []));

/**
 * Reads every figure the checks will ask about, before the first action. Those on another page are
 * read there, and the browser comes back to where it started.
 */
export async function readBefore(run: Running): Promise<void> {
  const all = watched(run);
  if (!all.length) return;
  const start = run.session.page.url();
  for (const c of all.filter((c) => !c.on)) run.before.set(readingKey(c), await read(run, c.figure));
  const elsewhere = all.filter((c) => c.on);
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
    if (s.type !== "check" || s.by !== "code") continue;
    for (const c of parts(s.expect)) {
      const before = c.kind === "changes" ? run.before.get(readingKey(c)) : undefined;
      if (c.kind === "changes" && before && "missing" in before) return { line, note: beforeNote(c, before.missing) };
    }
  }
}

const beforeNote = (c: Changes, missing: string) => `Before the test began${c.on ? `, on ${c.on}` : ""}: ${missing}`;

/** Whether a figure moved by what was named, give or take one unit of the last digit shown and half a percent. */
export function movedBy(before: Shown, now: Shown, by: number): boolean {
  const slack = Math.max(unitOf(now), Math.abs(by) * CHANGE_TOLERANCE);
  return Math.abs(now.value - before.value - by) <= slack + 1e-9;
}

async function changes(run: Running, expect: Changes): Promise<Found> {
  const before = run.before.get(readingKey(expect));
  if (!before || "missing" in before) return unsure(beforeNote(expect, before?.missing ?? `“${expect.figure}” wasn't read.`));
  const by = Number(expect.by);
  if (!Number.isFinite(by)) return unsure(`“${expect.by}” isn't a number.`);
  const now = await read(run, expect.figure);
  if ("missing" in now) return unsure(now.missing);
  if (movedBy(before, now, by)) return pass(`“${expect.figure}” went from ${before.text} to ${now.text}.`);
  const moved = Number((now.value - before.value).toPrecision(10));
  return fail(`“${expect.figure}” went from ${before.text} to ${now.text}: a change of ${moved}, not ${by}.`);
}

/** A figure with how it reads in a note, and the smallest step the page could have shown it in. */
interface Figure {
  value: number;
  unit: number;
  as: string;
}
type Read = Figure | { missing: string };

const tidy = (n: number) => String(Number(n.toPrecision(12)));

/** One figure: a number of the test's own, or one read off the page. */
async function term(run: Running, t: number | string | PageFigure): Promise<Read> {
  if (typeof t !== "object") {
    const value = Number(t);
    return Number.isFinite(value) ? { value, unit: 0, as: String(t) } : { missing: `“${t}” isn't a number.` };
  }
  const { page } = run.session;
  const several = (n: number) => ({ missing: `${n} rows hold “${t.row}”, so it can't say which one is meant.` });
  if (t.label) {
    const place = await placeOf(page, t);
    if ("missing" in place) return place;
    const texts = await textsIn(place);
    if (texts.length > 1) return several(texts.length);
    const found = labelled(texts[0]!, t.label);
    return found ? { value: found.value, unit: unitOf(found), as: `“${t.label}” ${found.text}` } : { missing: noLabel([t.label], texts[0]!).replace(" on the page", inPlace(t)) };
  }
  const place = await placeOf(page, { dialog: t.dialog });
  if ("missing" in place) return place;
  if (!t.column) {
    const n = await rowsHolding(place.root, t.row!).count();
    return { value: n, unit: 0, as: `${n} ${n === 1 ? "row" : "rows"} with “${t.row}”` };
  }
  const column = await readColumn(place.root, t.column, t.row);
  if ("missing" in column) return column;
  const { cells } = column;
  if (t.all === "count") return { value: cells.length, unit: 0, as: `${cells.length} ${cells.length === 1 ? "row" : "rows"} under “${t.column}”` };
  if (!t.all && cells.length !== 1) return cells.length ? several(cells.length) : { missing: `No row under “${t.column}” holds “${t.row}”.` };
  const read: Shown[] = [];
  for (const cell of cells) {
    // An empty cell or a dash is how a table writes nothing.
    const found = figureIn(cell) ?? (/^[\s—–-]*$/.test(cell) ? { text: "0", value: 0 } : undefined);
    if (!found) return { missing: `Under “${t.column}” a row reads “${cell.trim()}”, which isn't a figure.` };
    read.push(found);
  }
  const value = read.reduce((sum, r) => sum + r.value, 0);
  const unit = read.reduce((sum, r) => sum + unitOf(r), 0);
  return t.all ? { value, unit, as: `“${t.column}” over ${read.length} ${read.length === 1 ? "row" : "rows"} ${tidy(value)}` } : { value, unit, as: `“${t.column}” ${read[0]!.text}` };
}

/** One side of a comparison: a figure, or several added or multiplied. */
async function side(run: Running, s: FigureSide): Promise<Read> {
  const of = typeof s === "object" && "add" in s ? s.add : typeof s === "object" && "multiply" in s ? s.multiply : undefined;
  if (!of) return term(run, s as number | string | PageFigure);
  const read: Figure[] = [];
  for (const t of of) {
    const found = await term(run, t);
    if ("missing" in found) return found;
    read.push(found);
  }
  const adds = typeof s === "object" && "add" in s;
  const value = read.reduce((acc, r) => (adds ? acc + r.value : acc * r.value), adds ? 0 : 1);
  // What rounding can hide: each figure's own step, carried through the sum or the product.
  const unit = read.reduce((acc, r) => acc + (adds ? r.unit : r.value === 0 ? 0 : Math.abs((value / r.value) * r.unit)), 0);
  return { value, unit, as: `${read.map((r) => r.as).join(adds ? " + " : " × ")} = ${tidy(value)}` };
}

const RELATION = { equal: "equal to", "at-most": "at most", "at-least": "at least", less: "less than", more: "more than" } as const;

async function figures(run: Running, expect: Extract<CodeAssert, { kind: "figures" }>): Promise<Found> {
  const left = await side(run, expect.left);
  if ("missing" in left) return unsure(left.missing);
  const right = await side(run, expect.right);
  if ("missing" in right) return unsure(right.missing);
  const { is, within } = expect;
  const slack = within === undefined ? (is === "equal" ? Math.max(left.unit, right.unit) : 0) : typeof within === "number" ? within : (Math.abs(right.value) * parseFloat(within)) / 100;
  const off = left.value - right.value;
  const holds = is === "equal" ? Math.abs(off) <= slack + 1e-9 : is === "at-most" ? off <= slack + 1e-9 : is === "at-least" ? off >= -slack - 1e-9 : is === "less" ? off < 0 : off > 0;
  const give = within !== undefined && is !== "less" && is !== "more" ? ` (within ${within})` : "";
  return holds ? pass(`${left.as} is ${RELATION[is]} ${right.as}${give}.`) : fail(`${left.as} is not ${RELATION[is]} ${right.as}${give}: they are ${tidy(Math.abs(off))} apart.`);
}

/** Nothing raw on the page, or in what it said since the latest action began. */
async function noError(run: Running, expect: Extract<CodeAssert, { kind: "no-error" }>): Promise<Found> {
  const { session } = run;
  const place = await placeOf(session.page, expect);
  if ("missing" in place) return pass(place.missing);
  const now = rawError((await textsIn(place)).join("\n"));
  if (now) return fail(`The page shows ${now.what}${inPlace(expect)}: “${now.line}”.`);
  const gone = rawError(session.said.since(run.acted).join("\n"));
  if (gone) return fail(`The page said ${gone.what}: “${gone.line}”.`);
  return pass(`No raw error${inPlace(expect)}.`);
}
