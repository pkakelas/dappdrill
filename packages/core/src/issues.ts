import { z } from "zod";
import { EdgeCaseId } from "./edge-cases.js";

export const Severity = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

export const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const IssueCategory = z.enum(["signing", "wallet", "ui", "rpc"]);
export type IssueCategory = z.infer<typeof IssueCategory>;

export const CATEGORY_LABEL: Record<IssueCategory, string> = {
  signing: "Signing",
  wallet: "Wallet handling",
  ui: "UI",
  rpc: "RPC",
};

export const ConsoleEntry = z.object({
  level: z.enum(["log", "info", "warn", "error", "pageerror"]),
  text: z.string(),
  at: z.string(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

export const RpcLogEntry = z.object({
  chainId: z.number().int().optional(),
  url: z.string().optional(),
  method: z.string(),
  /** "page" for the dApp's own RPC calls, "wallet" for calls through the injected provider. */
  via: z.enum(["page", "wallet"]),
  durationMs: z.number(),
  error: z.string().optional(),
  at: z.string(),
});
export type RpcLogEntry = z.infer<typeof RpcLogEntry>;

export const Issue = z.object({
  id: z.string(),
  /** Stable across runs, used to dedupe and to track "new since last run". */
  fingerprint: z.string(),
  severity: Severity,
  category: IssueCategory,
  title: z.string(),
  /** Plain description of what went wrong and why it matters. */
  summary: z.string(),
  testId: z.string().optional(),
  testName: z.string().optional(),
  edgeCase: EdgeCaseId.optional(),
  runId: z.string().optional(),
  stepIndex: z.number().int().optional(),
  stepsToReproduce: z.array(z.string()).default([]),
  expected: z.string().optional(),
  actual: z.string().optional(),
  evidence: z
    .object({
      screenshot: z.string().optional(),
      video: z.string().optional(),
      trace: z.string().optional(),
      console: z.array(ConsoleEntry).optional(),
      rpc: z.array(RpcLogEntry).optional(),
      signingReviewId: z.string().optional(),
      /** "The button said" */
      buttonLabel: z.string().optional(),
      /** "The wallet was asked for" */
      walletAsked: z.string().optional(),
    })
    .default({}),
  /** Based on indexer/explorer data we couldn't confirm on the fork. */
  unverified: z.boolean().optional(),
  createdAt: z.string(),
});
export type Issue = z.infer<typeof Issue>;

/** The single status vocabulary used across the UI. Only problems get colour. */
export type Health = "broken" | "review" | "ok";

export const HEALTH_LABEL: Record<Health, string> = { broken: "Broken", review: "Review", ok: "OK" };

export function healthOfIssues(issues: Pick<Issue, "severity">[]): Health {
  if (issues.some((i) => i.severity === "critical" || i.severity === "high")) return "broken";
  if (issues.length > 0) return "review";
  return "ok";
}
