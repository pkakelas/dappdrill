import { z } from "zod";

/** A path on the app, from whatever was typed: a full URL keeps its path, "vault" becomes "/vault". */
function pathOf(text: string): string {
  try {
    const url = new URL(text);
    return `${url.pathname}${url.search}`;
  } catch {
    return text.startsWith("/") ? text : `/${text}`;
  }
}

const answer = (max: number) => z.string().trim().max(max);
const blank = (s: string | undefined) => s || undefined;

/**
 * What a developer answers when adding a test. Only the first two are needed: the goal is what
 * the writer turns into steps, and the expected result is what the judge checks on every run.
 */
export const TestBrief = z.object({
  goal: answer(300).min(3, "Say what the user does."),
  expected: answer(300).min(3, "Say what the page shows when it worked."),
  /** The page the test opens first. */
  startPath: answer(200).optional().transform((s) => (s ? pathOf(s) : undefined)),
  /** Tokens and amounts the steps should type. */
  amounts: answer(300).optional().transform(blank),
  /** Steps the developer already knows, in order. */
  steps: z.array(answer(200)).optional().transform((s) => (s ?? []).filter(Boolean)).pipe(z.array(z.string()).max(10, "Keep it under 10 steps.")),
});
export type TestBrief = z.infer<typeof TestBrief>;

/** How each answer is worded for the writer. */
export const BRIEF_LABELS = {
  expected: "What shows it worked",
  startPath: "Starts on",
  amounts: "Tokens and amounts",
  steps: "Steps to follow",
} as const;

const oneLine = (s: string) => s.replace(/\s+/g, " ");

/** The request the writer reads: the goal on the first line, then one line per answer. */
export function formatBrief(brief: TestBrief): string {
  return [
    oneLine(brief.goal),
    `${BRIEF_LABELS.expected}: ${oneLine(brief.expected)}`,
    ...(brief.startPath ? [`${BRIEF_LABELS.startPath}: ${brief.startPath}`] : []),
    ...(brief.amounts ? [`${BRIEF_LABELS.amounts}: ${oneLine(brief.amounts)}`] : []),
    ...(brief.steps.length ? [`${BRIEF_LABELS.steps}:`, ...brief.steps.map((s, i) => `${i + 1}. ${oneLine(s)}`)] : []),
  ].join("\n");
}

/** The goal of a request: its first line. A request that is one sentence is its own goal. */
export function briefGoal(request: string): string {
  return request.split("\n")[0]!.trim();
}

/** The reverse of formatBrief, for answers that were given. */
export function parseBrief(request: string): { goal: string; expected?: string; startPath?: string; amounts?: string; steps: string[] } {
  const [, ...lines] = request.split("\n");
  const after = (label: string) => lines.find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2);
  const from = lines.indexOf(`${BRIEF_LABELS.steps}:`);
  return {
    goal: briefGoal(request),
    expected: after(BRIEF_LABELS.expected),
    startPath: after(BRIEF_LABELS.startPath),
    amounts: after(BRIEF_LABELS.amounts),
    steps: from < 0 ? [] : lines.slice(from + 1).flatMap((l) => /^\d+\. (.+)$/.exec(l)?.[1] ?? []),
  };
}
