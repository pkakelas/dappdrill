import { sentence, type Action, type Check, type LineResult } from "@dappdrill/core";
import { isCode } from "@/lib/lines";
import { LINE_LABEL, LINE_STATE } from "./status";
import type { ViewLine } from "./test-run-view";

/** A line's words with this run's values in place of their names, so the page reads as what was done. */
function filled(text: string, values?: Record<string, string>) {
  if (!values) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => values[name] ?? whole);
}

/** The lines with how each went in a run. While a run is on, the first line with no result yet is the one being done. */
export function viewLines(prefix: string, lines: (Action | Check)[], results: LineResult[] | undefined, url: (p?: string | null) => string | null, values?: Record<string, string>, running?: boolean): ViewLine[] {
  const at = running && results ? results.findIndex((r) => r.status === "skipped") : -1;
  return lines.map((line, i) => {
    const r = results?.[i];
    const bad = r?.status === "fail" || r?.status === "unsure";
    return {
      key: `${prefix}${i}`,
      kind: line.type === "check" ? "check" : "action",
      text: filled(sentence(line), values),
      state: i === at ? "running" : r ? LINE_STATE[r.status] : "never",
      label: i === at ? "Running" : r ? LINE_LABEL[r.status] : "No result",
      note: r?.note && (bad || line.type === "check") ? r.note : undefined,
      tone: r?.status === "fail" ? "bad" : r?.status === "unsure" ? "warn" : "quiet",
      redone: r?.redone,
      did: bad ? r?.did : undefined,
      shot: url(r?.screenshot),
      notCode: !isCode(line),
    };
  });
}
