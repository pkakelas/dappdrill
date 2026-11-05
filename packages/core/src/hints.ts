/** How each answer is worded in the saved hints. The analyst reads these lines, and Settings reads them back. */
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
export type HintAnswers = { flows: string[]; tips: Partial<Record<HintTopic, string>> };

const TOPICS = Object.keys(HINT_LABELS) as HintTopic[];
const FLOWS_HEADING = "Flows to test:";

export function formatHints({ flows, tips }: HintAnswers): string {
  const filled = flows.map((flow) => flow.trim()).filter(Boolean);
  return [
    ...(filled.length ? [FLOWS_HEADING, ...filled.map((flow) => `- ${flow}`)] : []),
    ...TOPICS.filter((topic) => tips[topic]?.trim()).map((topic) => `${HINT_LABELS[topic]}: ${tips[topic]!.trim()}`),
  ].join("\n");
}

/** The reverse of formatHints. Text that isn't an answer, like notes saved before the questions existed, joins the notes. */
export function parseHints(text: string): HintAnswers {
  const answers: HintAnswers = { flows: [], tips: {} };
  const loose: string[] = [];
  const add = (topic: HintTopic, line: string) => (answers.tips[topic] = answers.tips[topic] === undefined ? line : `${answers.tips[topic]}\n${line}`);
  let open: HintTopic | "flows" | undefined;
  // Forms post newlines as \r\n, so that's how saved hints come back.
  for (const line of text.split(/\r?\n/)) {
    const topic = TOPICS.find((t) => line.startsWith(`${HINT_LABELS[t]}: `));
    if (line.trim() === FLOWS_HEADING) open = "flows";
    else if (topic) {
      open = topic;
      add(topic, line.slice(HINT_LABELS[topic].length + 2));
    } else if (open === "flows" && line.startsWith("- ")) answers.flows.push(line.slice(2).trim());
    else if (open && open !== "flows") add(open, line);
    else loose.push(line);
  }
  const note = loose.join("\n").trim();
  if (note) answers.tips.notes = answers.tips.notes ? `${note}\n${answers.tips.notes}` : note;
  for (const topic of TOPICS) if (answers.tips[topic] !== undefined) answers.tips[topic] = answers.tips[topic]!.trim();
  return answers;
}
