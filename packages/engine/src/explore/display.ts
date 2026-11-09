/**
 * Checks on what a page shows without anyone acting: numbers that are broken, and numbers that
 * should follow from each other. Pure text in, verdict out.
 */

/** A number as a page writes it: "$1,682.56", "0.3%", "1.2M". */
export function shownNumber(text: string): number | undefined {
  const m = /^[^\d.-]*(-?[\d,]*\.?\d+)\s*([kmbt])?\b/i.exec(text.trim());
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ""));
  const scale = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]?.toLowerCase() ?? ""] ?? 1;
  return Number.isFinite(n) ? n * scale : undefined;
}

/**
 * A page's text as a person reads it. Apps that animate a number put each character in its own
 * element, which comes out one per line ("$", "4", ".", "9", "8"); those are put back together.
 */
export function asRead(text: string): string {
  const out: string[] = [];
  let run = "";
  const flush = () => {
    if (run) out.push(run);
    run = "";
  };
  for (const line of text.split("\n")) {
    if (/^[\d.,$€£%+-]$/.test(line.trim())) run += line.trim();
    else {
      flush();
      out.push(line);
    }
  }
  flush();
  return out.join("\n");
}

/** For comparing a claim with the page: one space wherever either has any, and no thousands separators. */
export function loosely(text: string): string {
  return text.replace(/\s+/g, " ").replace(/(\d),(?=\d{3}\b)/g, "$1").trim();
}

/** The number on the page that a claim is about: the same text, or the nearest number within 1% of it. */
export function numberOnPage(pageText: string, claimed: string): { text: string; value: number } | undefined {
  const want = shownNumber(claimed);
  if (want === undefined) return undefined;
  if (pageText.includes(claimed.trim())) return { text: claimed.trim(), value: want };
  let best: { text: string; value: number } | undefined;
  for (const m of pageText.matchAll(/\d[\d,]*\.?\d*/g)) {
    const value = Number(m[0].replace(/,/g, ""));
    if (Math.abs(value - want) <= Math.abs(want) * 0.01 && (!best || Math.abs(value - want) < Math.abs(best.value - want))) best = { text: m[0], value };
  }
  return best;
}

/**
 * These are words too ("null and void", "Axie Infinity", "undefined until the epoch ends"), so only
 * where a value goes: first on its line or after a colon or a currency sign, and then before a
 * unit or the end of the line.
 */
const asValue = (word: string) => new RegExp(`(^|[$:=]\\s*)${word}(\\s*(%|[A-Z]{2,6}\\b)|$)`);
const BROKEN: [RegExp, string][] = [
  [/\bNaN\b/, "NaN"],
  [asValue("undefined"), "undefined"],
  [/\[object Object\]/, "[object Object]"],
  [asValue("-?Infinity"), "Infinity"],
  [asValue("null"), "null"],
  [/\b\d+(\.\d+)?e[+-]?\d{2,}\b/i, "a number in scientific notation"],
];

/** Lines of the page that show a value the code behind it failed to produce. */
export function brokenValues(pageText: string): { what: string; line: string }[] {
  const out: { what: string; line: string }[] = [];
  for (const raw of pageText.split("\n")) {
    const line = raw.trim();
    // Addresses and hashes hold "e" followed by digits.
    if (!line || /0x[0-9a-f]{8,}/i.test(line)) continue;
    const hit = BROKEN.find(([re]) => re.test(line));
    if (hit && !out.some((o) => o.line === line)) out.push({ what: hit[1], line: line.slice(0, 120) });
  }
  return out;
}

export interface SumResult {
  ok: boolean;
  /** Why it couldn't be checked at all (bad claim, a number that isn't on the page). */
  error?: string;
  left?: number;
  right?: number;
}

/** Whole constants a formula may bring itself: 1 − slippage, × 100, / 365. */
const isConstant = (literal: string) => /^\d{1,3}$/.test(literal);
const TOLERANCE = 0.005;

/**
 * "0.5 * 3365.12 = 1682.56": the left side worked out against the right side, to the digits the
 * right side shows or half a percent. Every number has to be on the page as written, so the claim
 * is about the page and not about the claimant's arithmetic.
 */
export function addsUp(claim: string, pageText: string): SumResult {
  const sides = claim.split(/=|≈/);
  if (sides.length !== 2) return { ok: false, error: 'Write it as "left side = right side", e.g. "0.5 * 3365.12 = 1682.56".' };
  const literals = claim.match(/[\d,]*\.?\d+/g) ?? [];
  // "2226.18" is on a page that writes "2,226.18".
  const flat = loosely(pageText);
  const absent = literals.filter((l) => !isConstant(l) && !flat.includes(loosely(l)));
  if (absent.length) return { ok: false, error: `${absent.map((l) => `“${l}”`).join(", ")} ${absent.length === 1 ? "isn't" : "aren't"} on the page as written.` };
  try {
    const left = evaluate(sides[0]!);
    const right = evaluate(sides[1]!);
    const digits = (sides[1]!.match(/\.(\d+)/)?.[1] ?? "").length;
    const slack = Math.max(10 ** -digits, Math.abs(right) * TOLERANCE);
    return { ok: Math.abs(left - right) <= slack, left, right };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** + − × ÷, brackets and percents, nothing else. */
export function evaluate(expr: string): number {
  const tokens = expr.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").match(/[\d,]*\.?\d+%?|[-+*/()]/g) ?? [];
  if (tokens.join("").length !== expr.replace(/[×x]/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/[\s$]/g, "").length) throw new Error(`Can't read “${expr.trim()}” as a sum: use numbers, + - * / and brackets.`);
  let i = 0;
  const number = (): number => {
    const t = tokens[i++];
    if (t === "(") {
      const v = sum();
      if (tokens[i++] !== ")") throw new Error("A bracket isn't closed.");
      return v;
    }
    if (t === "-") return -number();
    if (t === undefined || !/\d/.test(t)) throw new Error(`Can't read “${expr.trim()}” as a sum.`);
    const n = Number(t.replace(/[,%]/g, ""));
    return t.endsWith("%") ? n / 100 : n;
  };
  const product = (): number => {
    let v = number();
    while (tokens[i] === "*" || tokens[i] === "/") v = tokens[i++] === "*" ? v * number() : v / number();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") v = tokens[i++] === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i < tokens.length || !Number.isFinite(v)) throw new Error(`Can't read “${expr.trim()}” as a sum.`);
  return v;
}
