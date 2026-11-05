import type { ExplorePhase, ExploreState, ExplorerStatus, ExploreFeedLine, Tier } from "@dappdrill/core";
import type { explorations } from "@dappdrill/db";
import { artifactUrl } from "./artifacts";

export type Exploration = typeof explorations.$inferSelect;

export interface FlowCover {
  name: string;
  tier: Tier;
  checks: number;
  failed: number;
  bugs: number;
  tests: number;
  /** Why it has no verdict, when it hasn't. */
  gap?: string;
}

export interface ExplorerTile {
  id: string;
  title: string;
  flow: string;
  tier: Tier;
  status: ExplorerStatus;
  frame: string | null;
  url?: string;
  doing?: string;
  checks: number;
  bugs: number;
}

/** What the live view draws, cut down from the state: it goes to the browser every two seconds. */
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
  counts: Counts;
  flows: FlowCover[];
}

export interface Counts {
  checks: number;
  /** Bugs that are still real: suspected, being reproduced, or confirmed. */
  bugs: number;
  confirmed: number;
  tests: number;
  drafts: number;
  gaps: number;
  dangerous: number;
}

const EMPTY: ExploreState = { phase: "setup", flows: [], areas: [], explorers: [], checks: [], bugs: [], gaps: [], proposals: [], candidates: [], retire: [], signing: { dangerous: 0, check: 0, consistent: 0 }, feed: [] };

const TILES = 8;
const FEED = 30;
const ORDER: Record<ExplorerStatus, number> = { running: 0, queued: 1, done: 2, stopped: 2, failed: 2 };

const DISMISSED = new Set(["not-reproduced", "not-a-bug", "duplicate"]);

export const liveBug = (b: ExploreState["bugs"][number]) => !DISMISSED.has(b.status);

export function countsOf(s: ExploreState): Counts {
  return {
    checks: s.checks.length,
    bugs: s.bugs.filter(liveBug).length,
    confirmed: s.bugs.filter((b) => b.status === "confirmed").length,
    tests: s.candidates.filter((c) => c.status === "proved").length,
    drafts: s.candidates.filter((c) => c.status === "draft").length,
    gaps: s.gaps.length,
    dangerous: s.signing.dangerous,
  };
}

export function coverOf(s: ExploreState): FlowCover[] {
  return s.flows.map((f) => {
    const checks = s.checks.filter((c) => c.flow === f.name);
    const gap = s.gaps.find((g) => g.flow === f.name);
    return {
      name: f.name,
      tier: f.tier,
      checks: checks.length,
      failed: checks.filter((c) => c.status === "fail").length,
      bugs: s.bugs.filter((b) => b.flow === f.name && liveBug(b)).length,
      tests: s.candidates.filter((c) => c.flow === f.name && c.status === "proved").length,
      gap: gap && `${gap.what}: ${gap.why}`,
    };
  });
}

export function liveView(row: Exploration, appUrl: string): LiveView {
  const s = row.state ?? EMPTY;
  const recent = (e: { activeAt?: string; startedAt?: string }) => e.activeAt ?? e.startedAt ?? "";
  const tiles = [...s.explorers].sort((a, b) => ORDER[a.status] - ORDER[b.status] || recent(b).localeCompare(recent(a))).slice(0, TILES);
  return {
    id: row.id,
    status: row.status,
    stopping: row.stopRequested,
    phase: s.phase,
    startedAt: row.startedAt?.toISOString(),
    deadline: s.deadline,
    appUrl,
    explorers: tiles.map((e) => ({ id: e.id, title: e.title, flow: e.flow, tier: e.tier, status: e.status, frame: artifactUrl("explorations", row.id, e.frame), url: e.url, doing: e.doing, checks: e.checks, bugs: e.bugs })),
    feed: s.feed.slice(-FEED),
    counts: countsOf(s),
    flows: coverOf(s),
  };
}
