import { BUG_STATUS_LABEL, checkFate, openSuggestion, VARIATION_LABEL, type Active, type BugTriage, type ExploreBug, type ExploreCheckStatus, type ExploreFeedLine, type ExplorePhase, type ExploreState, type ExplorerStatus, type ExploreSuggestion, type Settled } from "@dappdrill/core";
import type { explorations } from "@dappdrill/db";
import { artifactUrl } from "./artifacts";

/** One pass over the app. The table still calls it an exploration. */
export type Pass = typeof explorations.$inferSelect;

export const passRunning = (p?: Pick<Pass, "status">) => p?.status === "queued" || p?.status === "running";

// ---------------------------------------------------------------- live

export interface ExplorerTile {
  id: string;
  title: string;
  status: ExplorerStatus;
  frame: string | null;
  url?: string;
  doing?: string;
}

/** What the live band draws, cut down from the state: it goes to the browser every two seconds. */
export interface LiveView {
  id: string;
  status: string;
  stopping: boolean;
  phase: ExplorePhase;
  startedAt?: string;
  deadline?: string;
  appUrl: string;
  explorers: ExplorerTile[];
  feed: ExploreFeedLine[];
}

const TILES = 8;
const FEED = 30;
const ORDER: Record<ExplorerStatus, number> = { running: 0, queued: 1, done: 2, stopped: 2, failed: 2 };

const DISMISSED = new Set<ExploreBug["status"]>(["not-reproduced", "not-a-bug", "duplicate"]);

export function liveView(pass: Pass, appUrl: string): LiveView {
  const s = pass.state;
  const recent = (e: { activeAt?: string; startedAt?: string }) => e.activeAt ?? e.startedAt ?? "";
  const tiles = [...(s?.explorers ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || recent(b).localeCompare(recent(a))).slice(0, TILES);
  return {
    id: pass.id,
    status: pass.status,
    stopping: pass.stopRequested,
    phase: s?.phase ?? "looking",
    startedAt: pass.startedAt?.toISOString(),
    deadline: s?.deadline,
    appUrl,
    explorers: tiles.map((e) => ({ id: e.id, title: e.title, status: e.status, frame: artifactUrl("explorations", pass.id, e.frame), url: e.url, doing: e.doing })),
    feed: s?.feed.slice(-FEED) ?? [],
  };
}

// ---------------------------------------------------------------- suggested

export interface SuggestedTest {
  id: string;
  name: string;
  goal: string;
  feature: string;
  /** What the pass is doing with it now, if anything. */
  now?: "trying" | "worked";
  /** Why it isn't a test, when it was tried and didn't work. */
  note?: string;
  /** Somebody added it, or the pass saved it without a pass. It keeps its line here until a run says something about it. */
  added?: Added;
}

export interface Added {
  testId: string;
  /** Queued or running now. */
  active?: Active;
  /** What its runs have said so far: nothing, or it wouldn't be here. */
  settled: Settled;
  /** Why its last run said nothing, when that is worth saying. */
  why?: string;
}

const NOW: Partial<Record<ExploreSuggestion["status"], SuggestedTest["now"]>> = { trying: "trying", worked: "worked", proving: "worked" };

/**
 * Tests that haven't run yet, in the order the pass wrote them: the ones it didn't save, and the
 * saved ones (`added`) that no run has said anything about. A run that says something moves the
 * test up into the list.
 */
export function suggestedTests(pass: Pass | undefined, saved: Set<string>, added: Map<string, Added>): SuggestedTest[] {
  return (pass?.state?.suggested ?? [])
    .filter((s) => added.has(s.draft.name) || (openSuggestion(s) && !saved.has(s.draft.name)))
    .map((s) => ({ id: s.id, name: s.draft.name, goal: s.draft.goal, feature: s.feature, now: NOW[s.status], note: s.note, added: added.get(s.draft.name) }));
}

// ---------------------------------------------------------------- bugs

export interface AppBug {
  bug: ExploreBug;
  passId: string;
  triage: BugTriage;
  shot: string | null;
  /** The test the explorer was trying when it found the bug: what its line is called. */
  title?: string;
  /** The test written from it. */
  test?: BugTest;
}

/** The test written from a bug, and how it last went. The bug is fixed once it passes. */
export interface BugTest {
  id: string;
  appId: string;
  active?: Active;
  settled: Settled;
}

/** The slice of an earlier pass the page needs: its bugs, and the names of the tests they came from. */
export type PassBugs = Pick<Pass, "id" | "triage"> & { bugs: ExploreBug[] | null; titles: Record<string, string> | null };

/**
 * Bugs belong to the app, not to one pass: whatever any pass confirmed stays open until its test
 * passes or a person dismisses it. The latest pass adds what it still suspects. `passes` come newest
 * first; a name shows once. `setAside` is what is out of the list: fixed, dismissed, or a report of
 * the latest pass that didn't hold up. `tests` are the tests written from bugs, by bug id.
 */
export function appBugs(passes: PassBugs[], tests = new Map<string, BugTest>()): { open: AppBug[]; setAside: AppBug[] } {
  const open: AppBug[] = [];
  const setAside: AppBug[] = [];
  const seen = new Set<string>();
  // A later pass finds the same bug again under a new id. A dismissal still stands; a fix doesn't, because the bug is back.
  const decided = new Map<string, BugTriage>();
  for (const pass of passes)
    for (const bug of pass.bugs ?? []) {
      const key = bug.name.toLowerCase();
      const triage = pass.triage[bug.id];
      if (triage && !decided.has(key)) decided.set(key, triage);
    }
  passes.forEach((pass, i) => {
    for (const bug of pass.bugs ?? []) {
      const key = bug.name.toLowerCase();
      if (seen.has(key)) continue;
      const triage = pass.triage[bug.id] ?? (decided.get(key) === "dismissed" ? "dismissed" : "open");
      const entry = { bug, passId: pass.id, triage, shot: artifactUrl("explorations", pass.id, bug.evidence.screenshot), title: pass.titles?.[bug.id], test: tests.get(bug.id) };
      const latest = i === 0;
      if (DISMISSED.has(bug.status)) {
        if (latest) setAside.push(entry);
        continue;
      }
      if (bug.status !== "confirmed" && !latest) continue;
      seen.add(key);
      (triage === "open" ? open : setAside).push(entry);
    }
  });
  const rank = (b: AppBug) => (b.bug.status === "confirmed" ? 0 : 1) * 10 + ["critical", "high", "medium", "low"].indexOf(b.bug.severity);
  return { open: open.sort((a, b) => rank(a) - rank(b)), setAside };
}

// ---------------------------------------------------------------- tried

export type TriedKind = ExploreCheckStatus | "gap";

export interface TriedLine {
  id: string;
  kind: TriedKind;
  name: string;
  feature: string;
  /** What the check found, or why it wasn't covered. */
  detail: string;
  variation?: string;
  /** What became of it: the test it was kept as, or the bug it turned into. */
  became?: { text: string; testName?: string; bugId?: string; tone?: "bad" };
}

/**
 * The check each bug came from. Bugs filed before that was recorded get the explorer's last check
 * before it filed the bug, when that check failed.
 */
function bugChecks(state: ExploreState): Map<string, ExploreBug> {
  const out = new Map<string, ExploreBug>();
  for (const bug of state.bugs) {
    if (bug.source !== "explorer") continue;
    const last = state.checks.filter((c) => c.explorerId === bug.explorerId && c.at <= bug.at).at(-1);
    const id = bug.checkId ?? (last?.status === "fail" ? last.id : undefined);
    if (id && !out.has(id)) out.set(id, bug);
  }
  return out;
}

function bugFate(bug: ExploreBug): TriedLine["became"] {
  if (bug.status === "confirmed") return { text: "Bug", bugId: bug.id, tone: "bad" };
  return { text: DISMISSED.has(bug.status) ? BUG_STATUS_LABEL[bug.status] : "Being reviewed" };
}

function became(state: ExploreState, suggestionId?: string): TriedLine["became"] {
  const fate = checkFate({ suggestionId }, state.suggested);
  const s = state.suggested.find((x) => x.id === suggestionId);
  if (fate === "test") return s?.status === "draft" ? { text: "Saved as a draft", testName: s.draft.name } : { text: "Kept as a test", testName: s?.draft.name };
  if (fate === "bug") return { text: "Bug", bugId: s?.bugId, tone: "bad" };
  if (fate === "suggested") return { text: "Suggested" };
  return undefined;
}

/** Every check the pass made, newest first, then what it couldn't cover. */
export function triedLines(state: ExploreState): TriedLine[] {
  const bugs = bugChecks(state);
  const checks = [...state.checks].reverse().map((c): TriedLine => {
    const bug = bugs.get(c.id);
    // A check that failed on the way to a test that was kept says nothing: only the ones that passed are in the test.
    const fate = bug ? bugFate(bug) : became(state, c.suggestionId);
    return { id: c.id, kind: c.status, name: c.name, feature: c.feature, detail: c.evidence, variation: VARIATION_LABEL[c.variation], became: c.status === "pass" || bug || fate?.bugId ? fate : undefined };
  });
  const gaps = state.gaps.map((g, i): TriedLine => ({ id: `gap-${i}`, kind: "gap", name: g.what, feature: g.feature, detail: g.why }));
  return [...checks, ...gaps];
}

/** What a finished pass came to, in a line. */
export function passSummary(state: ExploreState | null): { tests: number; drafts: number; bugs: number; tried: number } {
  const count = (status: ExploreSuggestion["status"]) => state?.suggested.filter((s) => s.status === status).length ?? 0;
  return { tests: count("proved"), drafts: count("draft"), bugs: state?.bugs.filter((b) => b.status === "confirmed").length ?? 0, tried: state?.checks.length ?? 0 };
}
