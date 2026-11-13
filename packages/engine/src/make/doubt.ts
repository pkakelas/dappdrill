/**
 * A second opinion before a test is kept as failing. Whoever wrote the test also decided the app was
 * wrong, so someone who wrote nothing looks for another explanation first: the test's own wording,
 * or something we set up ourselves.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { chainName, sentence, type Test, type TestResult } from "@dappdrill/core";
import type { Env } from "../run/env.js";
import type { ImageInput, Llm } from "../types.js";
import type { Finding } from "./draft.js";
import { SAID } from "../agent/said.js";

export const Doubt = z.object({
  verdict: z.enum(["app", "other"]),
  why: z.string().describe(`With app: the words or figures that show the fault. With other: what it is instead, so the test can be fixed. ${SAID}`),
});
export type Doubt = z.infer<typeof Doubt>;

export interface DoubtInput {
  test: Test;
  /** The latest of the runs that failed the same way. */
  run: TestResult;
  /** The failing line, from 0. */
  line: number;
  /** The fault as whoever left the line to fail put it. */
  finding?: Finding;
  notes: string[];
  /** What we set up, see `ours`. */
  ours: string;
  artifactsDir: string;
}

const SYSTEM = `A test for a web app was written by someone else and run several times. It fails the same way every time, and its author says the app is at fault. Before the app's owner is told they have a bug, you look for any other explanation. You wrote nothing here and have nothing to defend.

You get the goal, the test, its latest run line by line, the fault as the author put it, what was set up by us and not by the app, and the page at the failing line as text and as a picture.

verdict "app" only when all three hold:
- Something shows the fault and you can quote it: the app's own words that it then goes against, figures on the page that don't add up, a transaction that reverted, a wallet request that differs from what the page said, something the user was told had happened and that isn't there. That the test or its goal expected otherwise shows nothing: a test is written by guessing what an app should do.
- It isn't ours. The wallet, its funds and the chains were set up for the test. What the app does because of them is not its fault: no quote or route for an amount hardly any user holds, a figure from a server that reads the real chain and never saw what happened on the copy.
- It isn't the test. The failing line asks for something a user of this app is entitled to, in words the page can answer, and a user would call what happened wrong, not a choice the app made.

verdict "other" otherwise: another explanation is at least as likely, or what you were given doesn't settle it. Name the explanation: what the line took for granted that the app never promised, or which of our own doings accounts for what was seen.`;

export async function doubt(llm: Llm, input: DoubtInput): Promise<Doubt> {
  const { test, run, line, finding } = input;
  const shot = run.steps[line]?.screenshot;
  const png = shot ? await readFile(path.join(input.artifactsDir, shot)).catch(() => undefined) : undefined;
  const images: ImageInput[] = png ? [{ data: png.toString("base64"), mediaType: "image/png" }] : [];
  const prompt = [
    `Goal: ${test.goal}`,
    `The test: ${test.name}, starting on ${test.startPath}`,
    input.ours,
    input.notes.length ? `What is known about this app:\n${input.notes.map((n) => `- ${n}`).join("\n")}` : "",
    "",
    "The latest run:",
    ...run.steps.map((s, i) => `${i + 1}. [${test.steps[i]!.type}] ${sentence(test.steps[i]!)}\n   ${s.status}${s.note ? `: ${s.note}` : ""}`),
    "",
    finding ? `The fault as the author put it:\n- what: ${finding.what}\n- a user should get: ${finding.expected}\n- the app did: ${finding.saw}\n` : "",
    run.steps[line]?.page ? `The page at line ${line + 1}, as text:\n${run.steps[line]!.page}\n` : "",
    `Is the app at fault at line ${line + 1}?${png ? " The picture is the page at that line." : ""}`,
  ].filter(Boolean).join("\n");
  return llm.structured({ system: SYSTEM, prompt, images, schema: Doubt, name: "doubt" });
}

/** What we set up for the tests, said so that nobody takes its effects for the app's doing. */
export function ours(env: Env): string {
  const forks = env.chains.configs().filter((c) => c.mode === "fork");
  const live = env.chains.configs().filter((c) => c.mode === "live");
  const name = (id: number) => chainName(id);
  const funds = forks.map((c) => {
    const tokens = env.target.tokens.filter((t) => t.chainId === c.id).map((t) => `${t.amount} ${t.symbol ?? t.address}`);
    return `100 of the native coin${tokens.length ? ` and ${tokens.join(", ")}` : ""} on ${name(c.id)}`;
  });
  return [
    "Set up by us, not by the app:",
    forks.length ? `- The test wallet was made for the test and we put its funds there: ${funds.join("; ")}. That is more than most users hold, and an app may have no quote, route or room for all of it.` : "",
    forks.length ? `- ${forks.map((c) => name(c.id)).join(" and ")} ${forks.length > 1 ? "are local copies of the real chains" : "is a local copy of the real chain"}, made for this run and put back before every run. The app's own servers still read the real chain, where this wallet holds nothing and nothing the test did has happened: a figure, a history or a later step that comes from a server can miss what happened on the copy.` : "",
    live.length ? `- On ${live.map((c) => name(c.id)).join(" and ")} the account is on the live chain and keeps what earlier runs left: their orders and transfers are not this run's.` : "",
  ].filter(Boolean).join("\n");
}
