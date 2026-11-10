/**
 * Exploring an app: one pass that looks around, checks the setup, and gives each feature an
 * explorer with its own browser, fork and wallet. The look suggests tests; explorers try them and
 * find more. A suggested test is saved once it passes again on a clean fork from its plain steps,
 * with none of the explorer's memory. Everything else that was tried stays visible as a check.
 *
 * The whole picture is one ExploreState, stored on the exploration row and drawn live.
 */
import { z } from "zod";
import { CheckAssert, CheckResultStatus, TestCheck } from "./check.js";
import { EdgeCaseId } from "./edge-cases.js";
import { TestDraft, TestStep } from "./test.js";

/**
 * How much a feature matters. Critical: it signs, moves funds, or gates that. Important: balances,
 * positions, market data. Supporting: docs, legal, marketing; checked, never saved as tests.
 */
export const Tier = z.enum(["critical", "important", "supporting"]);
export type Tier = z.infer<typeof Tier>;

export const TIER_LABEL: Record<Tier, string> = { critical: "Critical", important: "Important", supporting: "Supporting" };

/** Most tests one pass saves per feature. A guess to tune. */
export const TIER_TESTS: Record<Tier, number> = { critical: 6, important: 3, supporting: 0 };

/** The share of the pass's time one explorer of this tier may use. A guess to tune. */
export const TIER_TIME: Record<Tier, number> = { critical: 0.5, important: 0.3, supporting: 0.15 };

export const ExplorePhase = z.enum(["looking", "setup", "exploring", "finishing", "done"]);
export type ExplorePhase = z.infer<typeof ExplorePhase>;

export const EXPLORE_PHASE_LABEL: Record<ExplorePhase, string> = {
  looking: "Looking around",
  setup: "Checking the setup",
  exploring: "Exploring",
  finishing: "Finishing up",
  done: "Done",
};

/** What an explorer tries around a feature. */
export const ExploreVariation = z.enum(["happy", "input", "path", "state", "agreement", "round-trip", "display"]);
export type ExploreVariation = z.infer<typeof ExploreVariation>;

export const VARIATION_LABEL: Record<ExploreVariation, string> = {
  happy: "Happy path",
  input: "Input",
  path: "Another route",
  state: "State",
  agreement: "Page vs chain",
  "round-trip": "Round trip",
  display: "What the page shows",
};

/** Something users do in one part of the app. Each gets an explorer. */
export const ExploreFeature = z.object({
  name: z.string(),
  tier: Tier,
  /** What put it in this tier. */
  why: z.string(),
  startPath: z.string().default("/"),
  /** What it holds and what to look out for, for its explorer. */
  brief: z.string().default(""),
});
export type ExploreFeature = z.infer<typeof ExploreFeature>;

export const ExplorerStatus = z.enum(["queued", "running", "done", "stopped", "failed"]);
export type ExplorerStatus = z.infer<typeof ExplorerStatus>;

/** One browser as the live view draws it: the look, the setup, an explorer, or a test being proved. */
export const Explorer = z.object({
  id: z.string(),
  title: z.string(),
  feature: z.string(),
  tier: Tier,
  status: ExplorerStatus,
  /** 1 for a feature's first explorer; higher when it earned another go. */
  round: z.number().int().default(1),
  /** Latest frame, relative to the exploration's artifacts. */
  frame: z.string().optional(),
  url: z.string().optional(),
  /** What it is doing right now, in a few words. */
  doing: z.string().optional(),
  /** The path it is on. */
  path: z.string().optional(),
  checks: z.number().int().default(0),
  bugs: z.number().int().default(0),
  summary: z.string().optional(),
  error: z.string().optional(),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  /** When it last did something; the view follows the most recent. */
  activeAt: z.string().optional(),
});
export type Explorer = z.infer<typeof Explorer>;

/** What a check's result is called while exploring: the same words as a kept check's. */
export const ExploreCheckStatus = CheckResultStatus;
export type ExploreCheckStatus = CheckResultStatus;

/** One thing an explorer tried: a path plus one check. Its status comes only from that check's result. */
export const ExploreCheck = z.object({
  id: z.string(),
  explorerId: z.string(),
  feature: z.string(),
  name: z.string(),
  variation: ExploreVariation,
  startPath: z.string(),
  /** What was done to get here, one line per action. */
  path: z.array(z.string()),
  assert: CheckAssert,
  status: ExploreCheckStatus,
  /** What the check found: the text, the receipt, the two balances. */
  evidence: z.string(),
  /** The path handled a signature. */
  signs: z.boolean().default(false),
  /** The suggested test this path was trying. */
  suggestionId: z.string().optional(),
  screenshot: z.string().optional(),
  at: z.string(),
});
export type ExploreCheck = z.infer<typeof ExploreCheck>;

export const BugSeverity = z.enum(["critical", "high", "medium", "low"]);
export type BugSeverity = z.infer<typeof BugSeverity>;

/** suspected: filed. reproducing: a fresh browser is trying it. The rest are reviewed. */
export const BugStatus = z.enum(["suspected", "reproducing", "confirmed", "not-reproduced", "not-a-bug", "duplicate"]);
export type BugStatus = z.infer<typeof BugStatus>;

export const BUG_STATUS_LABEL: Record<BugStatus, string> = {
  suspected: "Suspected",
  reproducing: "Reproducing",
  confirmed: "Confirmed",
  "not-reproduced": "Couldn't reproduce",
  "not-a-bug": "Not a bug",
  duplicate: "Duplicate",
};

export const BugEvidence = z.object({
  screenshot: z.string().optional(),
  /** Errors in the browser console around it. */
  console: z.array(z.string()).default([]),
  /** Hosts whose requests failed or hung. */
  network: z.array(z.string()).default([]),
  /** What the wallet and the chain said. */
  chain: z.array(z.string()).default([]),
});
export type BugEvidence = z.infer<typeof BugEvidence>;

export const ExploreBug = z.object({
  id: z.string(),
  explorerId: z.string(),
  feature: z.string(),
  name: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  /** What a test of it is called: what the user does, not what is wrong. */
  check: z.string().optional(),
  /** The check that failed, when the explorer filed the bug right after one. */
  checkId: z.string().optional(),
  /** A fresh browser followed the steps and saw it. Without this, a reviewer confirmed it from the evidence. */
  reproduced: z.boolean().optional(),
  severity: BugSeverity,
  status: BugStatus,
  /** Who filed it: an explorer, a test that failed on a clean fork with the wallet or chain against it, or the signing review. */
  source: z.enum(["explorer", "prove", "signing"]).default("explorer"),
  /** How many times it came up. A signature shows on every path that reaches it. */
  seen: z.number().int().default(1),
  evidence: BugEvidence,
  /** Why it was settled the way it was. */
  reasoning: z.string().optional(),
  duplicateOf: z.string().optional(),
  at: z.string(),
});
export type ExploreBug = z.infer<typeof ExploreBug>;

/**
 * What the test written from a bug is called. A test is named for what the user does, so it never
 * takes the bug's name: `title` is the test the explorer was on when it found the bug, and without
 * that or a name from the explorer it is what should have happened.
 */
export function bugTestName(bug: Pick<ExploreBug, "check" | "expected">, title?: string): string {
  const expected = bug.expected.split(/(?<=[.!?])\s/)[0]!.replace(/[.!]$/, "");
  return title ?? bug.check ?? expected;
}

/**
 * Where a confirmed bug stands. A person dismisses one or brings it back; `fixed` is set when
 * the test written from the bug passes.
 */
export const BugTriage = z.enum(["open", "fixed", "dismissed"]);
export type BugTriage = z.infer<typeof BugTriage>;

/** Something that wasn't covered, and why. A Critical feature ends with a verdict or one of these. */
export const ExploreGap = z.object({
  feature: z.string(),
  what: z.string(),
  why: z.string(),
});
export type ExploreGap = z.infer<typeof ExploreGap>;

/**
 * A suggested test on its way to being saved.
 * suggested: written, not tried yet (or tried and it didn't work; the note says why).
 * trying: an explorer is on it. worked: it worked once for the explorer. proving: on a clean fork now.
 * proved: it passed there, so it is saved. draft: it didn't, and is saved with the reason.
 * bug: it failed because the app did the wrong thing. dropped: it doesn't apply to this app.
 */
export const SuggestionStatus = z.enum(["suggested", "trying", "worked", "proving", "proved", "draft", "bug", "dropped"]);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

export const ExploreSuggestion = z.object({
  id: z.string(),
  feature: z.string(),
  tier: Tier,
  draft: TestDraft,
  /** The explorer that found it; none when the look wrote it. */
  explorerId: z.string().optional(),
  status: SuggestionStatus,
  /** Why it isn't a test. */
  note: z.string().optional(),
  bugId: z.string().optional(),
  /** Steps with the actions that worked, once proved. */
  steps: z.array(TestStep).optional(),
  /** The draft's after-steps with the actions that worked, once proved on a live chain. */
  after: z.array(TestStep).optional(),
  /**
   * Checks that passed on the explorer's path and can be made again, with how many of its actions
   * came before each. The proof tries them; the ones that pass there go on the test's steps.
   */
  checks: z.array(TestCheck.extend({ after: z.number().int().min(0) })).optional(),
  /** Conditions that could change its result. */
  conditions: z.array(EdgeCaseId).default([]),
  provedAt: z.string().optional(),
});
export type ExploreSuggestion = z.infer<typeof ExploreSuggestion>;

/** Still on offer: nothing has settled it. */
export const openSuggestion = (s: Pick<ExploreSuggestion, "status">) => s.status === "suggested" || s.status === "trying" || s.status === "worked" || s.status === "proving";

/** A line in the live feed. */
export const ExploreFeedLine = z.object({
  at: z.string(),
  kind: z.enum(["note", "pass", "fail", "error", "bug", "test", "wallet"]),
  text: z.string(),
  explorerId: z.string().optional(),
});
export type ExploreFeedLine = z.infer<typeof ExploreFeedLine>;

/** What the pass spent, in USD, by stage and by model role. */
export const ExploreCosts = z.object({
  stage: z.record(z.string(), z.number()).default({}),
  model: z.record(z.string(), z.number()).default({}),
});
export type ExploreCosts = z.infer<typeof ExploreCosts>;

export const ExploreState = z.object({
  phase: ExplorePhase.default("looking"),
  /** When exploring has to stop, whatever is left. */
  deadline: z.string().optional(),
  features: z.array(ExploreFeature).default([]),
  explorers: z.array(Explorer).default([]),
  suggested: z.array(ExploreSuggestion).default([]),
  checks: z.array(ExploreCheck).default([]),
  bugs: z.array(ExploreBug).default([]),
  gaps: z.array(ExploreGap).default([]),
  /** Signing review verdicts seen while exploring. */
  signing: z.object({ dangerous: z.number().int().default(0), check: z.number().int().default(0), consistent: z.number().int().default(0) }).prefault({}),
  feed: z.array(ExploreFeedLine).default([]),
  /** Why it stopped before exploring, when it did. */
  stopped: z.string().optional(),
  costs: ExploreCosts.optional(),
});
export type ExploreState = z.infer<typeof ExploreState>;

/** What must be settled before a pass may finish. */
export function closeGate(state: Pick<ExploreState, "bugs" | "features" | "checks" | "gaps">): { unreviewed: ExploreBug[]; unsettled: ExploreFeature[] } {
  const settled = (f: ExploreFeature) => state.checks.some((c) => c.feature === f.name && c.status !== "error") || state.gaps.some((g) => g.feature === f.name);
  return {
    unreviewed: state.bugs.filter((b) => b.status === "suspected" || b.status === "reproducing"),
    unsettled: state.features.filter((f) => f.tier === "critical" && !settled(f)),
  };
}

/** "Open login from BTC-USD" and "Open login from ETH-USD" read as the same thing here. */
export function checkKey(c: Pick<ExploreCheck, "feature" | "name" | "assert">): string {
  return [c.feature, c.assert.kind, c.assert.value ?? "", c.name].join("\n").toLowerCase().replace(/\s+/g, " ");
}

/** What became of a check, for the list of everything tried. */
export type CheckFate = "test" | "suggested" | "bug" | "none";

export function checkFate(check: Pick<ExploreCheck, "suggestionId">, suggested: Pick<ExploreSuggestion, "id" | "status">[]): CheckFate {
  const s = suggested.find((x) => x.id === check.suggestionId);
  if (!s || s.status === "dropped") return "none";
  if (s.status === "proved" || s.status === "draft") return "test";
  return s.status === "bug" ? "bug" : "suggested";
}
