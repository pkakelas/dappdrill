import type { Note } from "@dappdrill/core";

/** How each answer is worded in the app's notes. The models read these lines, and Settings reads them back. */
export const HINT_LABELS = {
  access: "How to get in",
  notes: "Hard to explore",
  success: "What success looks like",
  tokens: "Tokens and amounts",
  pages: "Hard-to-find pages",
  changed: "What just changed",
  breaks: "What keeps breaking",
  avoid: "What to avoid",
} as const;
export type HintTopic = keyof typeof HINT_LABELS;
export type HintAnswers = { tests: string[]; tips: Partial<Record<HintTopic, string>> };

const TOPICS = Object.keys(HINT_LABELS) as HintTopic[];
const TESTS_HEADING = "What to test:";

/** The answers as notes: one for what to test, one for each question answered. */
function hintNotes({ tests, tips }: HintAnswers): string[] {
  const filled = tests.map((test) => test.trim()).filter(Boolean);
  return [
    ...(filled.length ? [[TESTS_HEADING, ...filled.map((test) => `- ${test}`)].join("\n")] : []),
    ...TOPICS.filter((topic) => tips[topic]?.trim()).map((topic) => `${HINT_LABELS[topic]}: ${tips[topic]!.trim()}`),
  ];
}

export const formatHints = (answers: HintAnswers): string => hintNotes(answers).join("\n");

/** The reverse of formatHints. Text that isn't an answer joins the notes. */
export function parseHints(text: string): HintAnswers {
  const answers: HintAnswers = { tests: [], tips: {} };
  const loose: string[] = [];
  const add = (topic: HintTopic, line: string) => (answers.tips[topic] = answers.tips[topic] === undefined ? line : `${answers.tips[topic]}\n${line}`);
  let open: HintTopic | "tests" | undefined;
  // Forms post newlines as \r\n.
  for (const line of text.split(/\r?\n/)) {
    const topic = TOPICS.find((t) => line.startsWith(`${HINT_LABELS[t]}: `));
    if (line.trim() === TESTS_HEADING) open = "tests";
    else if (topic) {
      open = topic;
      add(topic, line.slice(HINT_LABELS[topic].length + 2));
    } else if (open === "tests" && line.startsWith("- ")) answers.tests.push(line.slice(2).trim());
    else if (open && open !== "tests") add(open, line);
    else loose.push(line);
  }
  const note = loose.join("\n").trim();
  if (note) answers.tips.notes = answers.tips.notes ? `${note}\n${answers.tips.notes}` : note;
  for (const topic of TOPICS) if (answers.tips[topic] !== undefined) answers.tips[topic] = answers.tips[topic]!.trim();
  return answers;
}

/** What the owner answered, as the app's own notes. What a look or a maker learned stays after them. */
export function withOwnerHints(notes: Note[], hints: string): Note[] {
  return [...hintNotes(parseHints(hints)).map((text) => ({ text, from: "owner" as const })), ...notes.filter((n) => n.from !== "owner")];
}

/** The owner's notes as the text the questions are filled from. */
export const ownerHints = (notes: Note[]): string =>
  notes
    .filter((n) => n.from === "owner")
    .map((n) => n.text)
    .join("\n");
