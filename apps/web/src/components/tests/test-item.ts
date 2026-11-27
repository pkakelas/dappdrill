import { formatDuration, type Done } from "@dappdrill/core";
import type { makes, RunStatus, TestRow, TestRunRow } from "@dappdrill/db";
import { artifactUrl } from "@/lib/artifacts";
import { tidy, timeAgo } from "@/lib/format";
import { unwritten } from "@/lib/lines";
import { saidShort } from "./said";
import { STATE_LABEL, STATE_TEXT, shortReason, type TestRead, type TestState } from "./status";
import type { ViewLine } from "./test-run-view";
import { viewLines } from "./view-lines";

/**
 * Where a test stands, each test one way: it found a bug, it failed, a run can't do it as it is (its last one
 * stopped on a step that no longer fits the page, or a step was added or reworded since), or its last result.
 */
export type Stands = "bug" | "failed" | "repair" | "unverified" | "never" | "passed";

export function standsAs(test: TestRow, read: TestRead, settled?: TestRunRow): Stands {
  if (settled?.result?.repairable || unwritten(test)) return "repair";
  if (read.settled === "failed") return test.faults.length > 0 ? "bug" : "failed";
  return read.settled;
}

/** The order of the list: what needs a look first, what passed last. */
export const STANDS_ORDER: Stands[] = ["bug", "failed", "repair", "unverified", "never", "passed"];

/** A line as the list draws it. `shot` is the page after it in the run the lines read from. */
export type ItemLine = Pick<ViewLine, "key" | "kind" | "text" | "state" | "label" | "note" | "tone"> & { shot?: string };

/** What a test's last run found that its lines don't say, for the test opened: a bug as it was written up, or what went wrong outside any line. */
export interface Found {
  /** The bug in a few words. */
  title?: string;
  expected?: string;
  saw?: string;
  /** What went wrong when it wasn't a line. */
  why?: string;
}

/** A test as the app's list draws it: how it stands, and its lines with how each went, for when it is opened. */
export interface TestItem {
  id: string;
  name: string;
  goal: string;
  /** The heading it is listed under with the tests like it. */
  group?: string;
  stands: Stands;
  mark: TestState;
  /** How it stands in a few words, when its mark and its time don't say it all: nothing for a test that passed. */
  label?: string;
  tone: string;
  /** While a run is on: "Step 2 of 7". */
  now?: string;
  /** The line under the name: the bug it found, or why its last run isn't Passed. */
  note?: { text: string; tone: string };
  /** How long its last run took and when it ended: "12s · 2 h ago". */
  when?: string;
  /** Made ready by the tests being generated now. */
  fresh: boolean;
  lines: ItemLine[];
  /** The lines were edited after the last result, so they don't say how each went. */
  stale: boolean;
  found?: Found;
  video: string | null;
  poster: string | null;
}

/**
 * What the last runs say that the last result doesn't: a failure that keeps coming back, or a test that goes
 * now one way and now the other. Nothing for a test that goes the same way every time.
 */
function history(read: TestRead, recent: RunStatus[]): { text: string; tone?: string } | undefined {
  if (read.settled === "never") return undefined;
  const other = recent.findIndex((s) => s !== "failed");
  const failing = other === -1 ? recent.length : other;
  if (read.settled === "failed" && failing >= 2) return { text: `Failed the last ${failing} runs` };
  const last = recent.slice(0, 5);
  const passed = last.filter((s) => s === "passed").length;
  if (last.length < 3 || passed === 0 || passed === last.length) return undefined;
  // A test that was fixed and has passed since changed its ways once, which is no news.
  const turns = last.filter((s, i) => i > 0 && (s === "passed") !== (last[i - 1] === "passed")).length;
  if (read.settled === "passed" && turns < 2) return undefined;
  return { text: `Passed ${passed} of the last ${last.length}`, tone: read.settled === "passed" ? "text-warn" : undefined };
}

/** `settled` is the result its status reads from, `latest` its newest run, `recent` how its last finished runs went, newest first. */
export function testItem({ test, read, stands, settled, latest, recent, fresh }: { test: TestRow; read: TestRead; stands: Stands; settled?: TestRunRow; latest?: TestRunRow; recent: RunStatus[]; fresh: boolean }): TestItem {
  const run = settled ?? latest;
  // The lines follow a run that is on, and otherwise say how the last result went.
  const running = latest?.status === "running";
  const shown = running ? latest : run;
  const result = shown?.result ?? undefined;
  const url = (path?: string | null) => (shown ? artifactUrl("runs", shown.batchId, path) : null);
  const lined = result && result.steps.length === test.steps.length ? result.steps : undefined;

  const done = running ? (result?.steps ?? []) : [];
  const now = !read.active ? undefined : running && done.length > 0 ? `Step ${Math.min(done.filter((s) => s.status !== "skipped").length + 1, done.length)} of ${done.length}` : running ? "Starting" : "Queued";

  const repair = stands === "repair";
  const words = repair ? { text: "Needs repair", tone: "text-warn" } : stands === "bug" ? { text: "Bug found", tone: "text-bad" } : (history(read, recent) ?? (read.settled === "passed" ? undefined : { text: STATE_LABEL[read.settled] }));
  const reason = run?.result?.reason;
  const fault = stands === "bug" ? test.faults[0] : undefined;
  const failed = read.settled === "failed";
  // A run's reason is mostly the line it stopped at and what it saw there, which the line itself says when the test is opened.
  const atLine = Boolean(reason && /^“[\s\S]+?”: /.test(reason));
  // Why a test needs repair is said once, where the repair is started.
  const told = !repair && reason && (failed || read.settled === "unverified") ? reason : undefined;
  const found: Found | undefined = repair ? undefined : fault ? { title: tidy(fault.what), expected: tidy(fault.expected), saw: fault.saw === fault.what ? undefined : tidy(fault.saw) } : told && !atLine ? { why: tidy(told) } : undefined;
  const note = fault ? { text: tidy(fault.what), tone: "text-bad-ink" } : told ? { text: tidy(shortReason(told, failed)), tone: failed ? "text-bad-ink" : "text-muted-foreground" } : undefined;
  const took = settled?.result && !repair ? formatDuration(settled.result.durationMs) : undefined;

  return {
    id: test.id,
    name: tidy(test.name),
    goal: tidy(test.goal),
    group: test.group ?? undefined,
    stands,
    mark: read.mark,
    label: words?.text,
    tone: words?.tone ?? STATE_TEXT[read.mark],
    now,
    note,
    when: run?.finishedAt ? [took, timeAgo(run.finishedAt)].filter(Boolean).join(" · ") : undefined,
    fresh,
    lines: viewLines("l", test.steps, lined, url, result?.values, running).map(({ key, kind, text, state, label, note, tone, shot }) => ({
      key,
      kind,
      text: tidy(text),
      state,
      label,
      note: tone === "quiet" || !note ? undefined : tidy(note),
      tone,
      shot: shot ?? undefined,
    })),
    stale: Boolean(result && !lined),
    found,
    video: running ? null : url(result?.video),
    poster: url(result?.steps.findLast((s) => s.screenshot)?.screenshot),
  };
}

/** A test being generated, as the app's list draws it in the place the test will take: what was asked for and what is going on. */
export interface MakingItem {
  /** The make's id. */
  id: string;
  /** What was asked for, without what should be seen. */
  name: string;
  goal: string;
  queued: boolean;
  stopping: boolean;
  /** When it started, for how long it has been going. */
  since?: string;
  /** The latest thing done, in a few words. */
  doing?: string;
  /** The latest note of the test maker, whole. */
  said?: string;
  log: Done[];
  /** The latest picture of our browser, and when it was taken. */
  frame?: string;
  taken?: number;
}

export function makingItem(make: typeof makes.$inferSelect): MakingItem {
  const { state } = make;
  const current = state.goals.find((g) => g.status === "making");
  const log = current?.log ?? [];
  const latest = log.at(-1)?.text ?? current?.said;
  const goal = tidy(make.goal ?? "Explore the app and generate its tests");
  const frame = make.status === "running" ? current?.frame : undefined;
  return {
    id: make.id,
    name: goal.split(". They should see: ")[0]!,
    goal,
    queued: make.status === "queued",
    stopping: make.stopRequested,
    since: make.startedAt?.toISOString(),
    doing: latest ? tidy(saidShort(latest)) : undefined,
    said: current?.said,
    log: current?.said ? log.filter((d) => d.text !== current.said) : log,
    frame: artifactUrl("makes", make.id, frame) ?? undefined,
    // The engine names each picture by its time.
    taken: Number(/-(\d{13})\.jpg$/.exec(frame ?? "")?.[1]) || undefined,
  };
}
