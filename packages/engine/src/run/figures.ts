/** Reading figures off a page's text: as a person reads it, and by the label next to them. */

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

/** A number as it stands in a line of the page: "3,365.12", "-$41.07", "-1.2%". */
const FIGURE = /[-−]?[$€£]?[\d,]*\.?\d+%?/;

/** A figure as the page wrote it, without its currency mark, and what it comes to. A percentage is a share: 2% is 0.02. */
export interface Shown {
  text: string;
  value: number;
}

/** The first figure in a piece of text. */
export function figureIn(text: string): Shown | undefined {
  const m = FIGURE.exec(loosely(text));
  if (!m) return undefined;
  const written = m[0].replace("−", "-").replace(/[$€£]/, "");
  const value = Number(written.replace(/[,%]/g, "")) / (written.endsWith("%") ? 100 : 1);
  return Number.isFinite(value) ? { text: written, value } : undefined;
}

/** The smallest step a figure can show: 0.01 for "12.30", 1 for "12". What rounding can hide. */
export function unitOf(shown: Shown): number {
  const digits = shown.text.split(".")[1]?.replace(/\D/g, "").length ?? 0;
  return 10 ** -digits / (shown.text.endsWith("%") ? 100 : 1);
}

/**
 * The figure the page shows under a label: the first number after the label on its line, else the
 * first on the next two lines (apps put a label and its value in separate elements). Case doesn't matter.
 * A line that begins with the label wins over one that only mentions it: "Vault shares" is the row of that
 * name, not the sentence above it that says "receive vault shares … and a 5% bonus", and "Total" isn't "Subtotal".
 */
export function labelled(pageText: string, label: string): Shown | undefined {
  const lines = pageText.split("\n").map((l) => loosely(l)).filter(Boolean);
  const want = loosely(label).toLowerCase();
  if (!want) return undefined;
  for (const begins of [true, false]) {
    for (let i = 0; i < lines.length; i++) {
      const at = lines[i]!.toLowerCase().indexOf(want);
      if (at < 0 || (begins && at > 0)) continue;
      for (const where of [lines[i]!.slice(at + want.length), lines[i + 1] ?? "", lines[i + 2] ?? ""]) {
        const shown = figureIn(where);
        if (shown) return shown;
      }
    }
  }
  return undefined;
}

/**
 * The labels the page shows figures under, for saying which one a claim could have named: the words
 * before a figure on its line, else the line above when that has no figure of its own.
 */
export function labelsOnPage(pageText: string, most = 12): string[] {
  const lines = pageText.split("\n").map((l) => loosely(l)).filter(Boolean);
  const words = (s: string | undefined) => Boolean(s && /[A-Za-z]{2,}/.test(s));
  const out: string[] = [];
  for (let i = 0; i < lines.length && out.length < most; i++) {
    const m = FIGURE.exec(lines[i]!);
    if (!m) continue;
    const before = lines[i]!.slice(0, m.index).replace(/[:$€£]\s*$/, "").trim();
    const above = lines[i - 1];
    const label = words(before) ? before : words(above) && !FIGURE.test(above!) ? above! : undefined;
    if (label && label.length <= 40 && !out.includes(label)) out.push(label);
  }
  return out;
}

/** How a missing label reads, with the labels the page does show figures under. */
export function noLabel(missing: string[], pageText: string): string {
  const labels = labelsOnPage(pageText);
  const quoted = (xs: string[]) => xs.map((l) => `“${l}”`).join(", ");
  return `No figure labelled ${quoted(missing)} on the page.${labels.length ? ` The figures on it are labelled ${quoted(labels)}.` : ""}`;
}

/**
 * What a user shouldn't be shown in place of a message: each with its name and how it reads. Kept to what
 * is never an app's own wording, so a page that says "Something went wrong" in plain words is none of these.
 */
const RAW: [string, RegExp][] = [
  ["“[object Object]”", /\[object Object\]/],
  ["a stack trace", /^\s*at \S.*:\d+:\d+\)?\s*$/m],
  ["an exception's name", /\b(?:Uncaught|Unhandled(?: Promise)? ?Rejection|[A-Z][A-Za-z]*(?:Error|Exception))\b:/],
  ["an error code", /(?:^|[\s(:])-32\d{3}\b|\bE(?:CONN(?:REFUSED|RESET|ABORTED)|TIMEDOUT|NOTFOUND|AI_AGAIN)\b|\b(?:CALL_EXCEPTION|UNPREDICTABLE_GAS_LIMIT|ACTION_REJECTED|INSUFFICIENT_FUNDS|NETWORK_ERROR|SERVER_ERROR)\b|\b(?:status(?: code)?|HTTP(?: error)?):? ?[45]\d\d\b(?![.,%]?\d)|\b50[0234] (?:Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time-?out)\b/i],
  ["a library's own error text", /\bviem@\d|\bethers(?:\.js)?@\d|\bRequest Arguments:|\bContract Call:|\bexecution reverted\b|\bat position \d+ in JSON\b|\bUnexpected token\b/],
  ["raw JSON", /\{\s*"[\w-]+"\s*:/],
  ["“undefined” where a value belongs", /\bundefined\b/],
  ["“NaN” where a value belongs", /\bNaN\b/],
];

/** What in a text is a raw error, when something is: its name, and the line it stands on. */
export function rawError(text: string): { what: string; line: string } | undefined {
  for (const [what, shape] of RAW) {
    const m = shape.exec(text);
    if (!m) continue;
    const line = text.slice(text.lastIndexOf("\n", m.index) + 1).split("\n")[0]!.trim();
    return { what, line: line.length > 160 ? `${line.slice(0, 159)}…` : line };
  }
  return undefined;
}
