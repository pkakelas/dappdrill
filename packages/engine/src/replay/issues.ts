/**
 * Issue construction and the deterministic page checks the edge-case runner
 * relies on: did the page recover, is a button stuck, is there a message.
 */
import type { Page } from "playwright";
import {
  describeStep,
  edgeCaseInfo,
  fingerprint,
  newId,
  nowIso,
  type ConsoleEntry,
  type EdgeCaseId,
  type Flow,
  type Issue,
  type IssueCategory,
  type RpcLogEntry,
  type Severity,
} from "@dappdrill/core";

export interface IssueDraft {
  /** Stable kind used in the fingerprint ("stuck-button", "wrong-chain"…). */
  kind: string;
  severity: Severity;
  category: IssueCategory;
  title: string;
  summary: string;
  expected?: string;
  actual?: string;
  stepIndex?: number;
  evidence?: Issue["evidence"];
  unverified?: boolean;
}

export interface IssueContext {
  flow: Flow;
  edgeCase: EdgeCaseId;
  runId: string;
  /** How this edge case was set up, in plain words, prepended to the steps. */
  setup: string[];
  evidence: Issue["evidence"];
}

export function makeIssue(ctx: IssueContext, draft: IssueDraft): Issue {
  return {
    id: newId("iss"),
    fingerprint: fingerprint(ctx.flow.id, ctx.edgeCase, draft.kind),
    severity: draft.severity,
    category: draft.category,
    title: draft.title,
    summary: draft.summary,
    flowId: ctx.flow.id,
    flowName: ctx.flow.name,
    edgeCase: ctx.edgeCase,
    runId: ctx.runId,
    stepIndex: draft.stepIndex,
    stepsToReproduce: [...ctx.setup, ...ctx.flow.steps.map((s, i) => `${i + 1}. ${describeStep(s)}`)],
    expected: draft.expected,
    actual: draft.actual,
    evidence: { ...ctx.evidence, ...draft.evidence },
    unverified: draft.unverified,
    createdAt: nowIso(),
  };
}

const BUSY_TEXT = /confirm|pending|processing|loading|submitting|waiting|sending|signing|approving|depositing|withdrawing|swapping|in progress|\.{3}|…/i;
const MESSAGE_TEXT = /reject|cancel|denied|declined|error|fail|unsuccessful|try again|insufficient|not enough|exceeds? (your |the )?(available |wallet )?balance|balance (is )?too low|wrong network|switch (the )?network|unsupported (chain|network)|something went wrong|unavailable/i;

export interface RecoveryState {
  pageText: string;
  /** Label of a button left disabled with a busy label (or the triggering button, disabled). */
  stuckButton?: string;
  /** First line of text that reads like feedback to the user. */
  message?: string;
  blank: boolean;
}

/** Look at the page after an edge case hit: stuck buttons, feedback text, blank screen. */
export async function inspectRecovery(page: Page, triggerLabel?: string): Promise<RecoveryState> {
  const snapshot = await page
    .evaluate((label) => {
      const text = document.body?.innerText ?? "";
      const buttons = [...document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"]')]
        .filter((b) => b.offsetParent !== null || b.getClientRects().length > 0)
        .map((b) => ({
          text: (b.getAttribute("aria-label") || b.innerText || (b as HTMLInputElement).value || "").replace(/\s+/g, " ").trim(),
          disabled: (b as HTMLButtonElement).disabled || b.getAttribute("aria-disabled") === "true",
        }));
      const trigger = label ? buttons.find((b) => b.text === label) : undefined;
      return { text, buttons, triggerDisabled: trigger?.disabled ?? false, elements: document.body?.querySelectorAll("*").length ?? 0 };
    }, triggerLabel ?? null)
    .catch(() => ({ text: "", buttons: [] as { text: string; disabled: boolean }[], triggerDisabled: false, elements: 0 }));

  const busy = snapshot.buttons.find((b) => b.disabled && BUSY_TEXT.test(b.text) && b.text.length < 60);
  const message = feedbackMessage(snapshot.text);
  // A disabled button next to a reason (Lido: "amount exceeds your available balance") is the dApp blocking a bad input, not a hang.
  const stuckButton = busy?.text ?? (snapshot.triggerDisabled && !message ? triggerLabel : undefined);
  const blank = snapshot.text.trim().length < 20 && snapshot.elements < 15;
  return { pageText: snapshot.text, stuckButton, message, blank };
}

/** First line of page text that reads like feedback to the user. */
export function feedbackMessage(pageText: string): string | undefined {
  return pageText
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 3 && l.length < 300 && MESSAGE_TEXT.test(l));
}

export function edgeLabel(id: EdgeCaseId): string {
  return edgeCaseInfo(id).label.toLowerCase();
}

export function pickConsole(entries: ConsoleEntry[]): ConsoleEntry[] {
  return entries.filter((e) => e.level === "error" || e.level === "pageerror" || e.level === "warn").slice(-20);
}

export function pickRpc(entries: RpcLogEntry[]): RpcLogEntry[] {
  return entries.slice(-30);
}
