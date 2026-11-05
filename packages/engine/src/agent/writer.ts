/**
 * Writes tests from a sentence: a new test in a flow, a fork of an existing
 * one ("the same but a limit sell"), or a rewrite. One structured call; steps
 * whose text stays the same keep their cached actions.
 */
import { TestDraft, type AppMap } from "@dappdrill/core";
import type { Llm } from "../types.js";

export const WRITE_SYSTEM = `You write end-to-end tests for a web app in plain English, for busy developers.
- name: what the user does, e.g. "Limit sell on ETH perp".
- goal: one sentence.
- expected: one sentence about what the page shows at the end when it worked: final values ("Balance shows 5 USDC"), not changes ("rises by 5") or earlier moments, and no prices or rates that move. Amounts can be rounded on screen, so say "about 0.01 stETH".
- steps: 3 to 8 short imperative steps of 3 to 7 words, at the level a user thinks ("Connect the wallet", "Open the ETH market", "Enter 0.01 as size"). No selectors.
When you change an existing test, keep every step that still applies word for word, so its recorded actions are reused. Change only what the request needs.`;

export interface DraftInput {
  /** What the developer asked for. */
  prompt: string;
  map?: AppMap;
  /** The test to fork or rewrite. */
  base?: { name: string; goal: string; expected: string; startPath: string; steps: { text: string }[] };
  /** The flow the test goes in. */
  flowName?: string;
}

export async function draftTest(llm: Llm, input: DraftInput): Promise<TestDraft> {
  const { base } = input;
  const prompt = [
    input.map ? `About the app: ${input.map.summary}\nPages:\n${input.map.pages.map((p) => `- ${p.path}: ${p.purpose}`).join("\n")}\n` : "",
    input.flowName ? `Flow: ${input.flowName}` : "",
    base
      ? [
          "The existing test:",
          `name: ${base.name}`,
          `goal: ${base.goal}`,
          `expected: ${base.expected}`,
          `startPath: ${base.startPath}`,
          "steps:",
          ...base.steps.map((s, i) => `${i + 1}. ${s.text}`),
          "",
        ].join("\n")
      : "",
    `Request: ${input.prompt}`,
  ].filter(Boolean).join("\n");
  return llm.structured({ system: WRITE_SYSTEM, prompt, schema: TestDraft, name: "test" });
}
