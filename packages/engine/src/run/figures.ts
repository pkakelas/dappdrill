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

/** A number as it stands in a line of the page: "3,365.12", "-1.2%", with the sign and no currency mark. */
const FIGURE = /-?[\d,]*\.?\d+%?/;

/**
 * The figure the page shows under a label: the first number after the label on its line, else the
 * first on the next two lines (apps put a label and its value in separate elements). Case doesn't matter.
 */
export function labelled(pageText: string, label: string): { text: string; value: number } | undefined {
  const lines = pageText.split("\n").map((l) => loosely(l)).filter(Boolean);
  const want = loosely(label).toLowerCase();
  if (!want) return undefined;
  for (let i = 0; i < lines.length; i++) {
    const at = lines[i]!.toLowerCase().indexOf(want);
    if (at < 0) continue;
    for (const where of [lines[i]!.slice(at + want.length), lines[i + 1] ?? "", lines[i + 2] ?? ""]) {
      const m = FIGURE.exec(where);
      if (!m) continue;
      const value = Number(m[0].replace(/[,%]/g, "")) / (m[0].endsWith("%") ? 100 : 1);
      if (Number.isFinite(value)) return { text: m[0], value };
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
