import { cx } from "@/components/ui";

type Tone = "good" | "bad" | "warn" | "live" | "fork" | "quiet";

/** A note the test maker said, in parts: what happened, the test's line it is about, and why. */
export interface Said {
  label?: string;
  tone: Tone;
  /** "98 s" for a run. */
  meta?: string;
  line?: string;
  detail?: string;
}

const TEXT: Record<Tone, string> = { good: "text-good", bad: "text-bad", warn: "text-warn", live: "text-live", fork: "text-fork", quiet: "text-muted-foreground" };
const DOT: Record<Tone, string> = { good: "bg-good-bar", bad: "bg-bad-mid", warn: "bg-warn-bar", live: "bg-live", fork: "bg-fork", quiet: "bg-foreground/30" };

const LINE = "“([^”]*)”";
const REST = "([\\s\\S]*)";
const RUN: Record<string, { label: string; tone: Tone }> = { Passed: { label: "passed", tone: "good" }, Failed: { label: "failed", tone: "bad" }, "Couldn't verify": { label: "couldn't verify", tone: "warn" } };

// What the test maker says as it goes (packages/engine/src/make/maker.ts and prove.ts). A note of another shape shows as it is.
const SHAPES: [RegExp, (m: string[]) => Said][] = [
  [/^Drafting: /, () => ({ label: "Writing the test", tone: "live" })],
  [new RegExp(`^Drafted ${LINE}: (\\d+) lines`), (m) => ({ label: "Test written", tone: "live", meta: `${m[2]} lines` })],
  [/^Run (\d+): (Passed|Failed|Couldn't verify), (\d+) s, \$[\d.]+(?:\. ([\s\S]*))?$/, (m) => ({ label: `Run ${m[1]} ${RUN[m[2]!]!.label}`, tone: RUN[m[2]!]!.tone, meta: `${m[3]} s`, detail: m[4] || undefined })],
  [new RegExp(`^The app is wrong at ${LINE}: ${REST}`), (m) => ({ label: "Looks like a bug", tone: "bad", line: m[1], detail: m[2] })],
  [new RegExp(`^A second look agrees the app is at fault at ${LINE}: ${REST}`), (m) => ({ label: "Bug confirmed", tone: "bad", line: m[1], detail: m[2] })],
  [new RegExp(`^A second look at ${LINE} didn't put it on the app: ${REST}`), (m) => ({ label: "Not a bug after all", tone: "warn", line: m[1], detail: m[2] })],
  [new RegExp(`^Couldn't tell about ${LINE}: ${REST}`), (m) => ({ label: "Couldn't tell", tone: "warn", line: m[1], detail: m[2] })],
  [new RegExp(`^Repaired ${LINE}: ${REST}`), (m) => ({ label: "Repaired a line", tone: "fork", line: m[1], detail: m[2] })],
  [new RegExp(`^Reworded ${LINE}: ${REST}`), (m) => ({ label: "Reworded a line", tone: "fork", line: m[1], detail: m[2] })],
  [new RegExp(`^A repair wasn't taken: ${REST}`), (m) => ({ label: "Repair not taken", tone: "quiet", detail: m[1] })],
];

export function readSaid(text: string): Said {
  for (const [shape, read] of SHAPES) {
    const m = shape.exec(text);
    if (m) return read([...m]);
  }
  return { tone: "quiet", detail: text };
}

/** The note in a few words, for where there is room for one line. */
export function saidShort(text: string): string {
  return readSaid(text).label ?? text;
}

/** What happened, the line it was at, and why, all of it. */
export function SaidNote({ text }: { text: string }) {
  const said = readSaid(text);
  return (
    <div className="flex min-w-0 flex-col gap-1 text-xs">
      {said.label && (
        <p className={cx("flex items-center gap-1.5 font-medium", TEXT[said.tone])}>
          <span aria-hidden="true" className={cx("size-1.5 shrink-0 rounded-full", DOT[said.tone])} />
          {said.label}
          {said.meta && <span className="font-normal text-muted-foreground">· {said.meta}</span>}
        </p>
      )}
      {said.line && <p className="border-l-2 pl-2 text-pretty text-foreground/80">{said.line}</p>}
      {said.detail && <p className="text-pretty break-words text-muted-foreground">{said.detail}</p>}
    </div>
  );
}
