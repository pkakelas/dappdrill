/**
 * What a goal that got no test leaves its owner: why there is none, said from what was seen, and the one
 * question whose answer would most likely let the test be made. Asked once, at the end, from all that was tried.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { sentence, type Test, type TestResult } from "@dappdrill/core";
import { ASK, SAID } from "../agent/said.js";
import type { ImageInput, Llm } from "../types.js";
import type { Finding } from "./draft.js";

export const Asked = z.object({
  why: z.string().describe(`What got in the way, from what was seen: the button, text or figure that went differently, and how. Not that it "wasn't steady". ${SAID}`),
  ask: z.string().describe(ASK),
});
export type Asked = z.infer<typeof Asked>;

export interface AskInput {
  goal: string;
  /** Why it was given up, as the maker put it. */
  why: string;
  /** The test as it last stood, when one was written. */
  test?: Test;
  /** Runs of the test as it last stood, oldest first. */
  runs: TestResult[];
  /** What was changed along the way, and why. */
  repairs: string[];
  /** What a second look wouldn't put on the app. */
  dismissed: string[];
  findings: Finding[];
  notes: string[];
  /** What we set up, see `ours`. */
  ours: string;
  artifactsDir: string;
}

const SYSTEM = `A test was being made for a web app from a goal: done once, written down as lines, then run until two runs in a row went the same way. It never got there, so there is no test. The app's owner will read why, and answer one question so the test can be made again with their answer.

You get the goal, the reason it was given up, what was set up by us and not by the app, what is known about the app, the test as it last stood with how each line went in each of its latest runs, what was changed along the way and why, and the page where it last went wrong, as text and as a picture.

why: what got in the way, concretely. Name the line's button, text or figure and what it did, with the numbers seen: "Deposited still read 0 USDC a minute after the 150 USDC deposit, in two of three runs." Never "it wasn't steady" or "it couldn't be done".

ask: the one thing only the owner knows that decides it. Usually one of:
- whether what happened is how the app is meant to work ("Should Deposited show 150 USDC right after the deposit, or only once Arbitrum confirms it?")
- how long something takes to show, or what has to happen first
- which figure, amount, account, page or option is meant
- a step a user takes first that the test didn't know about
When the cause is our own setup (a server that reads the real chain, the test wallet's funds), ask what would let it be checked anyway. Use the app's own words and the figures seen. Never ask what the page already answers, anything about the test or how it is made, or something whose answer would change nothing.`;

export async function askOwner(llm: Llm, input: AskInput): Promise<Asked> {
  const { test, runs } = input;
  const last = runs.at(-1);
  const at = last?.steps.findIndex((s) => s.status === "fail" || s.status === "unsure") ?? -1;
  const step = at >= 0 ? last!.steps[at] : undefined;
  const png = step?.screenshot ? await readFile(path.join(input.artifactsDir, step.screenshot)).catch(() => undefined) : undefined;
  const images: ImageInput[] = png ? [{ data: png.toString("base64"), mediaType: "image/png" }] : [];
  const list = (title: string, items: string[]) => (items.length ? `${title}\n${items.map((i) => `- ${i}`).join("\n")}` : "");
  const prompt = [
    `Goal: ${input.goal}`,
    `Given up because: ${input.why}`,
    input.ours,
    list("What is known about this app:", input.notes),
    test
      ? [
          `The test as it last stood, with each of its latest ${runs.length} runs (oldest first):`,
          ...test.steps.map((line, i) => {
            const seen = runs.map((r) => r.steps[i]?.status ?? "skipped").join(", ");
            const notes = [...new Set(runs.map((r) => r.steps[i]?.note).filter(Boolean))].slice(-2);
            return `${i + 1}. [${line.type}] ${sentence(line)}\n   ${seen || "not run"}${notes.map((n) => `\n   ${n}`).join("")}`;
          }),
        ].join("\n")
      : "No test was written: it was given up while the goal was first being done.",
    list("What was changed along the way:", input.repairs),
    list("What a second look didn't put on the app:", input.dismissed),
    list(
      "What looked wrong with the app:",
      input.findings.map((f) => `${f.what} (a user should get: ${f.expected}; the app did: ${f.saw})`),
    ),
    step?.page ? `The page where it last went wrong (line ${at + 1}), as text:\n${step.page}` : "",
    `Why is there no test, and what one question for the owner would most likely let it be made?${png ? " The picture is the page where it last went wrong." : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return llm.structured({ system: SYSTEM, prompt, images, schema: Asked, name: "ask_owner" });
}
