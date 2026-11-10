/**
 * Writes tests from a sentence: a new test, a fork of an existing
 * one ("the same but a limit sell"), or a rewrite. One structured call; steps
 * whose text stays the same keep their cached actions.
 */
import { TestDraft, type AppMap } from "@dappdrill/core";
import type { Llm } from "../types.js";

const WRITE_SYSTEM = `You write end-to-end tests for a web app in plain English, for busy developers.
- name: what the user does, e.g. "Limit sell on ETH perp".
- goal: one sentence.
- expected: one sentence about what the page shows at the end when it worked: final values ("Balance shows 5 USDC"), not changes ("rises by 5") or earlier moments, and no prices or rates that move. Amounts can be rounded on screen, so say "about 0.01 stETH". When you are told the tests run on a live chain, the account's figures differ on every run: there say the change ("Cash falls by about $20"), which the run judges against what the page showed before its first step.
- steps: 3 to 8 short imperative steps of 3 to 7 words, at the level a user thinks ("Connect the wallet", "Open the ETH market", "Enter 0.01 as size"). No selectors.
When you change an existing test, keep every step that still applies word for word, so its recorded actions are reused. Change only what the request needs.
The request can come with the developer's answers on the lines under it. They know the app, so take them as given:
- "What shows it worked" is the expected result: keep their texts and values, in the form above.
- "Starts on" is the startPath.
- "Tokens and amounts" are the values the steps type.
- "Steps to follow" are the steps in their order, each cut to the short form above. Add a step only where one is plainly missing.
When you are told what the app's setup does, the test starts after it: don't repeat those steps.`;

export interface DraftInput {
  /** What the developer asked for. */
  prompt: string;
  map?: AppMap;
  /** What the app's setup does before every test. */
  setup?: string[];
  /** A chain the tests run on can't be forked: one live account keeps what every run leaves. */
  live?: boolean;
  /** The test to fork or rewrite. */
  base?: { name: string; goal: string; expected: string; startPath: string; steps: { text: string }[] };
}

export async function draftTest(llm: Llm, input: DraftInput): Promise<TestDraft> {
  const { base } = input;
  const prompt = [
    input.map ? `About the app: ${input.map.summary}\nPages:\n${input.map.pages.map((p) => `- ${p.path}: ${p.purpose}`).join("\n")}\n` : "",
    input.setup?.length ? `Before every test the app's setup already does this:\n${input.setup.map((s) => `- ${s}`).join("\n")}\n` : "",
    input.live ? "The tests run on a live chain, on one account that keeps what earlier runs left: a test that leaves an order, a deposit or a position open gets after steps that put it back.\n" : "",
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
