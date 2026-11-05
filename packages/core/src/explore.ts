/**
 * Exploring an app in depth, after the first look. A coordinator gives explorers an area each;
 * every explorer has its own browser, fork and wallet. What they check is cut into records of
 * one path plus one check, the ones that matter become tests, and each of those has to pass
 * again on a fresh fork, with none of the explorer's memory, before it is saved.
 *
 * The whole picture is one ExploreState, stored on the exploration row and drawn live.
 */
import { z } from "zod";
import { EdgeCaseId } from "./edge-cases.js";
import { Step } from "./flow.js";
import { TestDraft, TestStep } from "./test.js";

/**
 * How much a flow matters. Critical: it signs, moves funds, or gates that. Important: balances,
 * positions, market data. Supporting: docs, legal, marketing; checked, never saved as tests.
 */
export const Tier = z.enum(["critical", "important", "supporting"]);
export type Tier = z.infer<typeof Tier>;

export const TIER_LABEL: Record<Tier, string> = { critical: "Critical", important: "Important", supporting: "Supporting" };

/** Most saved tests per flow. A guess to tune. */
export const TIER_TESTS: Record<Tier, number> = { critical: 12, important: 4, supporting: 0 };

/** Share of the exploring time per tier, handed out to that tier's areas. A guess to tune. */
export const TIER_TIME: Record<Tier, number> = { critical: 0.7, important: 0.2, supporting: 0.1 };

export const ExplorePhase = z.enum(["setup", "planning", "exploring", "extracting", "proving", "confirming", "closing", "done"]);
export type ExplorePhase = z.infer<typeof ExplorePhase>;

export const EXPLORE_PHASE_LABEL: Record<ExplorePhase, string> = {
  setup: "Connecting",
  planning: "Planning",
  exploring: "Exploring",
  extracting: "Sorting checks",
  proving: "Proving tests",
  confirming: "Confirming bugs",
  closing: "Closing",
  done: "Done",
};

/** What an explorer tries around a flow. */
export const ExploreVariation = z.enum(["happy", "input", "path", "state", "agreement", "round-trip"]);
export type ExploreVariation = z.infer<typeof ExploreVariation>;

export const VARIATION_LABEL: Record<ExploreVariation, string> = {
  happy: "Happy path",
  input: "Input",
  path: "Another route",
  state: "State",
  agreement: "Page vs chain",
  "round-trip": "Round trip",
};

/** A piece of the app given to one explorer. */
export const ExploreArea = z.object({
  id: z.string(),
  title: z.string(),
  flow: z.string(),
  tier: Tier,
  brief: z.string(),
  startPath: z.string().default("/"),
  exclude: z.array(z.string()).default([]),
  /** 1 for the plan; higher when spare time goes back into a flow. */
  round: z.number().int().default(1),
});
export type ExploreArea = z.infer<typeof ExploreArea>;

export const ExplorerStatus = z.enum(["queued", "running", "done", "stopped", "failed"]);
export type ExplorerStatus = z.infer<typeof ExplorerStatus>;

/** One explorer as the live view draws it. */
export const Explorer = z.object({
  id: z.string(),
  title: z.string(),
  flow: z.string(),
  tier: Tier,
  status: ExplorerStatus,
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

/**
 * What a check asserts. Code decides the result, never the model:
 * shows / hides: text on the page. url: the address contains it. wallet: a signature was asked for
 * and its decoded summary contains it. no-wallet: nothing was asked to sign. tx: the latest
 * transaction was mined and didn't revert. balance: the number on the page matches the chain.
 */
export const CheckAssert = z.object({
  kind: z.enum(["shows", "hides", "url", "wallet", "no-wallet", "tx", "balance"]),
  value: z.string().optional(),
  /** balance: the ERC-20 address; leave out for the native coin. */
  token: z.string().optional(),
});
export type CheckAssert = z.infer<typeof CheckAssert>;

/** Same words as tests: pass, fail, or error when the check couldn't be made. */
export const ExploreCheckStatus = z.enum(["pass", "fail", "error"]);
export type ExploreCheckStatus = z.infer<typeof ExploreCheckStatus>;

/** One path plus one check. Its status comes only from that check's result. */
export const ExploreCheck = z.object({
  id: z.string(),
  explorerId: z.string(),
  flow: z.string(),
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
  screenshot: z.string().optional(),
  at: z.string(),
});
export type ExploreCheck = z.infer<typeof ExploreCheck>;

/** What a sweep needs to repeat a check without a model. Kept apart from the state: the live view has no use for it. */
export const CheckReplay = z.object({
  id: z.string(),
  name: z.string(),
  flow: z.string(),
  startPath: z.string(),
  actions: z.array(Step),
  assert: CheckAssert,
});
export type CheckReplay = z.infer<typeof CheckReplay>;

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
  flow: z.string(),
  name: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  expected: z.string(),
  actual: z.string(),
  severity: BugSeverity,
  status: BugStatus,
  /** Who filed it: an explorer, a failed check nobody filed, or the signing review. */
  source: z.enum(["explorer", "check", "signing"]).default("explorer"),
  evidence: BugEvidence,
  /** Why it was settled the way it was. */
  reasoning: z.string().optional(),
  duplicateOf: z.string().optional(),
  at: z.string(),
});
export type ExploreBug = z.infer<typeof ExploreBug>;

/** Set by a person on a finished exploration. */
export const BugTriage = z.enum(["open", "accepted", "duplicate", "cant-reproduce", "works-as-intended"]);
export type BugTriage = z.infer<typeof BugTriage>;

export const BUG_TRIAGE_LABEL: Record<BugTriage, string> = {
  open: "Open",
  accepted: "Accepted",
  duplicate: "Duplicate",
  "cant-reproduce": "Can't reproduce",
  "works-as-intended": "Works as intended",
};

/** Something that wasn't checked, and why. A Critical flow ends with a verdict or one of these. */
export const ExploreGap = z.object({
  flow: z.string(),
  what: z.string(),
  why: z.string(),
});
export type ExploreGap = z.infer<typeof ExploreGap>;

/** Work an explorer found outside its area. */
export const ExploreProposal = z.object({
  title: z.string(),
  evidence: z.string(),
  startPath: z.string().default("/"),
  status: z.enum(["open", "accepted", "declined"]).default("open"),
  note: z.string().optional(),
});
export type ExploreProposal = z.infer<typeof ExploreProposal>;

/**
 * A test on its way to being saved. proving: on a fresh fork now. proved: passed twice.
 * draft: it failed, the reason stays with it. demoted: it passed once then failed, so it stays a check.
 */
export const CandidateStatus = z.enum(["waiting", "proving", "proved", "draft", "demoted"]);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

export const ExploreCandidate = z.object({
  id: z.string(),
  flow: z.string(),
  tier: Tier,
  draft: TestDraft,
  /** The checks it came from. */
  checkIds: z.array(z.string()).default([]),
  /** Why it earned a test of its own. */
  why: z.string(),
  status: CandidateStatus,
  /** Why it isn't proved. */
  note: z.string().optional(),
  /** A regression test for a confirmed bug: it fails until the bug is fixed. */
  bugId: z.string().optional(),
  /** Steps with the actions that worked, once proved. */
  steps: z.array(TestStep).optional(),
  proof: z.string().optional(),
  /** Conditions that could change its result. */
  conditions: z.array(EdgeCaseId).default([]),
});
export type ExploreCandidate = z.infer<typeof ExploreCandidate>;

export const ExploreFlow = z.object({
  name: z.string(),
  tier: Tier,
  /** What put it in this tier. */
  why: z.string(),
});
export type ExploreFlow = z.infer<typeof ExploreFlow>;

/** A line in the live feed. */
export const ExploreFeedLine = z.object({
  at: z.string(),
  kind: z.enum(["note", "pass", "fail", "error", "bug", "test", "wallet"]),
  text: z.string(),
  explorerId: z.string().optional(),
});
export type ExploreFeedLine = z.infer<typeof ExploreFeedLine>;

export const ExploreState = z.object({
  phase: ExplorePhase.default("setup"),
  /** Ends when exploring has to stop; proving and confirming come after it. */
  deadline: z.string().optional(),
  flows: z.array(ExploreFlow).default([]),
  areas: z.array(ExploreArea).default([]),
  explorers: z.array(Explorer).default([]),
  checks: z.array(ExploreCheck).default([]),
  bugs: z.array(ExploreBug).default([]),
  gaps: z.array(ExploreGap).default([]),
  proposals: z.array(ExploreProposal).default([]),
  candidates: z.array(ExploreCandidate).default([]),
  /** Tests that look out of date. A person decides. */
  retire: z.array(z.object({ testId: z.string(), name: z.string(), reason: z.string() })).default([]),
  /** Signing review verdicts seen while exploring. */
  signing: z.object({ dangerous: z.number().int().default(0), check: z.number().int().default(0), consistent: z.number().int().default(0) }).prefault({}),
  feed: z.array(ExploreFeedLine).default([]),
  /** Why it stopped before exploring, when it did. */
  stopped: z.string().optional(),
});
export type ExploreState = z.infer<typeof ExploreState>;

/** What must be settled before an exploration may finish. */
export function closeGate(state: Pick<ExploreState, "bugs" | "flows" | "checks" | "gaps">): { unreviewed: ExploreBug[]; unsettled: ExploreFlow[] } {
  const settled = (f: ExploreFlow) => state.checks.some((c) => c.flow === f.name && c.status !== "error") || state.gaps.some((g) => g.flow === f.name);
  return {
    unreviewed: state.bugs.filter((b) => b.status === "suspected" || b.status === "reproducing"),
    unsettled: state.flows.filter((f) => f.tier === "critical" && !settled(f)),
  };
}

/** "Open login from BTC-USD" and "Open login from ETH-USD" read as the same thing here. */
export function checkKey(c: Pick<ExploreCheck, "flow" | "name" | "assert">): string {
  return [c.flow, c.assert.kind, c.assert.value ?? "", c.name].join("\n").toLowerCase().replace(/\s+/g, " ");
}

/** What a later sweep found for each check, by check id. */
export const SweepResults = z.object({
  at: z.string(),
  results: z.record(z.string(), z.object({ status: ExploreCheckStatus, evidence: z.string() })),
});
export type SweepResults = z.infer<typeof SweepResults>;
