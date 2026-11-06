import { checkFate, openSuggestion, VARIATION_LABEL, type BugTriage, type ExploreBug, type ExploreCheckStatus, type ExploreFeedLine, type ExplorePhase, type ExploreState, type ExplorerStatus, type ExploreSuggestion } from "@dappdrill/core";
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
  counts: { tried: number; tests: number; bugs: number };
}

const TILES = 8;
const FEED = 30;
const ORDER: Record<ExplorerStatus, number> = { running: 0, queued: 1, done: 2, stopped: 2, failed: 2 };

const DISMISSED = new Set<ExploreBug["status"]>(["not-reproduced", "not-a-bug", "duplicate"]);
const SET_ASIDE = new Set<BugTriage>(["duplicate", "cant-reproduce", "works-as-intended"]);

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
    counts: {
      tried: s?.checks.length ?? 0,
      tests: s?.suggested.filter((x) => x.status === "proved").length ?? 0,
      bugs: s?.bugs.filter((b) => !DISMISSED.has(b.status)).length ?? 0,
    },
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
}

const NOW: Partial<Record<ExploreSuggestion["status"], SuggestedTest["now"]>> = { trying: "trying", worked: "worked", proving: "worked" };

/** Tests the pass wrote but hasn't saved, in the order it wrote them. One a person has added since is a test, not a suggestion. */
export function suggestedTests(pass: Pass | undefined, saved: Set<string>): SuggestedTest[] {
  return (pass?.state?.suggested ?? [])
    .filter((s) => openSuggestion(s) && !saved.has(s.draft.name))
    .map((s) => ({ id: s.id, name: s.draft.name, goal: s.draft.goal, feature: s.feature, now: NOW[s.status], note: s.note }));
}

// ---------------------------------------------------------------- bugs

export interface AppBug {
  bug: ExploreBug;
  passId: string;
  triage: BugTriage;
  shot: string | null;
}

/** The slice of an earlier pass the page needs: only its bugs. */
export type PassBugs = Pick<Pass, "id" | "triage"> & { bugs: ExploreBug[] | null };

/**
 * Bugs belong to the app, not to one pass: whatever any pass confirmed stays until a person sets it
 * aside. The latest pass adds what it still suspects. `passes` come newest first; a name shows once,
 * with the newest decision made about it.
 */
export function appBugs(passes: PassBugs[]): { open: AppBug[]; setAside: AppBug[] } {
  const open: AppBug[] = [];
  const setAside: AppBug[] = [];
  const seen = new Set<string>();
  // A later pass finds the same bug again under a new id; what a person decided about it still stands.
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
      const triage = pass.triage[bug.id] ?? decided.get(key) ?? "open";
      const entry = { bug, passId: pass.id, triage, shot: artifactUrl("explorations", pass.id, bug.evidence.screenshot) };
      const latest = i === 0;
      if (DISMISSED.has(bug.status)) {
        if (latest) setAside.push(entry);
        continue;
      }
      if (bug.status !== "confirmed" && !latest) continue;
      seen.add(key);
      (SET_ASIDE.has(triage) ? setAside : open).push(entry);
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
  /** What became of it. */
  became?: { text: string; testName?: string; tone?: "bad" };
}

function became(state: ExploreState, suggestionId?: string): TriedLine["became"] {
  const fate = checkFate({ suggestionId }, state.suggested);
  const s = state.suggested.find((x) => x.id === suggestionId);
  if (fate === "test") return s?.status === "draft" ? { text: "Saved as a draft", testName: s.draft.name } : { text: "Saved as a test", testName: s?.draft.name };
  if (fate === "bug") return { text: "Bug", tone: "bad" };
  if (fate === "suggested") return { text: "Suggested" };
  return undefined;
}

/** Everything the pass tried, newest first, then what it couldn't cover. */
export function triedLines(state: ExploreState): TriedLine[] {
  const checks = [...state.checks].reverse().map(
    (c): TriedLine => ({ id: c.id, kind: c.status, name: c.name, feature: c.feature, detail: c.evidence, variation: VARIATION_LABEL[c.variation], became: became(state, c.suggestionId) }),
  );
  const gaps = state.gaps.map((g, i): TriedLine => ({ id: `gap-${i}`, kind: "gap", name: g.what, feature: g.feature, detail: g.why }));
  return [...checks, ...gaps];
}

/** What a finished pass came to, in a line. */
export function passSummary(state: ExploreState | null): { tests: number; drafts: number; bugs: number; tried: number } {
  const count = (status: ExploreSuggestion["status"]) => state?.suggested.filter((s) => s.status === status).length ?? 0;
  return { tests: count("proved"), drafts: count("draft"), bugs: state?.bugs.filter((b) => b.status === "confirmed").length ?? 0, tried: state?.checks.length ?? 0 };
}
