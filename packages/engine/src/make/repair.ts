/**
 * Deciding what to do about a line that doesn't pass while a new test is being proven: the test is
 * wrong and is put right, the app is wrong and the line stands, or it can't be told yet.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { RunValue, sentence, type Test, type TestResult } from "@dappdrill/core";
import type { ImageInput, Llm } from "../types.js";
import { asLine, BLOCKER, DraftLine, Finding, wrongValues } from "./draft.js";
import { SAID } from "../agent/said.js";

const Edit = z.object({
  line: z.number().int().min(1).describe("The line's number as listed"),
  op: z.enum(["replace", "remove", "insert-before"]),
  with: DraftLine.optional().describe("The new line, for replace and insert-before"),
});

export const Repair = z.object({
  verdict: z.enum(["test", "app", "cant-tell", "in-the-way"]),
  why: z.string().describe(`What decides it. ${SAID}`),
  blocker: z.string().optional().describe(`With verdict in-the-way: ${BLOCKER}`),
  again: z.boolean().optional().describe("True when an earlier repair of this test was about this same thing and it still goes wrong the same way"),
  edits: z.array(Edit).default([]),
  values: z
    .array(z.object({ name: z.string().regex(/^\w+$/), ...RunValue.shape }))
    .optional()
    .describe("Only when the values change: all of them, as they should be now"),
  finding: Finding.optional().describe("With verdict app, unless it is a problem already written down"),
  known: z.number().int().min(1).optional().describe("With verdict app: the number of the problem already written down that this is"),
  note: z.string().optional().describe("With verdict app, when later tests of this app will meet the same fault: how to get past it, in one sentence"),
});
export type Repair = z.infer<typeof Repair>;

const SYSTEM = `A test for a web app has just been written and is being run several times to prove it. One line didn't pass, or passed in one run and not in another. You decide why, and what happens to the test. You get the goal, the test, how each run of it went line by line, and the page at that line in the latest run, as text and as a picture of what was in view.

How a test is run: each line is an action or a check. An action by code replays a recording; an action by a model is done from its sentence. A check by code looks for one exact fact; a check by a model is answered from the page at that moment, what the page showed during the latest action and took away, and what the wallet was asked. When a line doesn't pass, later actions aren't done.

verdict "test": the test is wrong or loose. The line names something the page writes differently; states a figure that differs from run to run; claims something no user is entitled to; can't be decided from what its reader sees; an action's sentence is too vague to do, or a step is missing before it. Put it right with edits.
verdict "app": the app is at fault, and you can point at what shows it: the app's own words that it then goes against, figures on the page that don't add up, a transaction that reverted, a wallet request that differs from what the page said, something the user was told had happened and that isn't there. That the goal or a line of the test expected otherwise is not enough: when the only thing the app goes against is the test, the test is wrong. And rule out first what was set up by us and not by the app (you are told what): what the app does because of the test wallet's funds or because a chain is a local copy is not its fault, and a test may not depend on it. With the fault shown, the line stands as written and the test will fail on it: that is the test doing its job. Give the finding. Edit the test only when the goal of this test is something else and it can reach its goal another way a user would take; give a note when later tests of this app will meet the same fault. A check after a line that was left to fail may fail only because of that fault: then it is the same problem (known), and it stands too. Would it be wrong without the fault as well, it is the test's.
verdict "cant-tell": what you have doesn't settle it. The test is run again.
verdict "in-the-way": something that is neither the test nor a fault of the app stops it, and running again or rewording won't get past it: a market that never fills, a service that is down, the account left by an earlier run in a state the test can't start from (a cleanup that didn't finish shows it). Give the blocker. The test is given up.

Set again when an earlier repair of this test was about this same thing and the line still goes wrong the same way. The test is then given up, whatever the verdict: repairs that change nothing only cost runs. Don't set it when the earlier repair changed what goes wrong.

Edits:
- A check may not be weakened into one that says less so that it passes. It may be reworded when what it said was wrong to claim, and removed when nothing its reader sees can decide it reliably. Say which in why.
- Don't add waiting or reloading that a user wouldn't need. A page that only shows the truth after a reload is the app's fault.
- A line that passed in one run and not in another, with the test unchanged: find what differed between the runs. If it is a figure or a text that changes by itself, the line shouldn't state it. If it is the app being late sometimes and right in the end, a check by code that waits (shows, said, changes) is steadier than a model's single look.
- A text that showed for a moment and was gone when the check looked (a toast, a button's label right after a click) is no reason to remove the check: make it a check by code with kind "said", which also reads what the page showed since the latest action began.
- Leave lines that passed exactly as they are: their recordings are kept. Change only what has to change.
- A check by code needs expect: {kind:"signed", holds} | {kind:"not-signed", holds?} | {kind:"mined", holds?} | {kind:"changes", figure, by, on?: the path of the page the figure is read on, like "/home"} | {kind:"said", text} | {kind:"shows", text} | {kind:"hides", text} | {kind:"button", name, is} | {kind:"url", contains}.
- An action by "code" is recorded once and replayed; by "llm" a model reads the page every run. Make an action "llm" when its recording can't be the same on every run.`;

export interface RepairInput {
  test: Test;
  /** Runs of the test as it is worded now, oldest first. The last is the one that didn't pass. */
  runs: TestResult[];
  /** The line to decide, from 0. */
  line: number;
  /** It passed in an earlier run of the same wording. */
  flips: boolean;
  /** What earlier repairs of this test did. */
  earlier: string[];
  notes: string[];
  /** What was already found wrong with the app. */
  problems: Finding[];
  /** Why a second look didn't put this line's failing on the app. The test may not be kept failing on it. */
  objection?: string;
  /** What we set up, see `ours` in doubt.ts. */
  ours?: string;
  artifactsDir: string;
}

/** A line as the repairer reads it. */
function written(line: Test["steps"][number], i: number): string {
  const expect = line.type === "check" && line.by === "code" ? `  expect ${JSON.stringify(line.expect)}` : "";
  return `${i + 1}. [${line.type} by ${line.by}] ${sentence(line)}${expect}`;
}

export async function repair(llm: Llm, input: RepairInput): Promise<Repair> {
  const { test, runs, line } = input;
  const latest = runs.at(-1)!;
  const shot = latest.steps[line]?.screenshot;
  const png = shot ? await readFile(path.join(input.artifactsDir, shot)).catch(() => undefined) : undefined;
  const images: ImageInput[] = png ? [{ data: png.toString("base64"), mediaType: "image/png" }] : [];
  const prompt = [
    `Goal: ${test.goal}`,
    `The test: ${test.name}, starting on ${test.startPath}`,
    Object.keys(test.values).length
      ? `Values picked on every run: ${Object.entries(test.values)
          .map(([n, v]) => `${n} from ${v.from} to ${v.to}`)
          .join("; ")}`
      : "",
    input.ours ?? "",
    input.notes.length ? `What is known about this app:\n${input.notes.map((n) => `- ${n}`).join("\n")}` : "",
    "",
    "Lines:",
    ...test.steps.map(written),
    test.cleanup.length ? `Cleanup, when it stops half way:\n${test.cleanup.map((c) => `- ${c.do}`).join("\n")}` : "",
    "",
    ...runs.flatMap((r, n) => [
      `Run ${n + 1}${
        Object.keys(r.values).length
          ? ` (${Object.entries(r.values)
              .map(([k, v]) => `${k} = ${v}`)
              .join(", ")})`
          : ""
      }: ${r.outcome}${r.reason ? `. ${r.reason}` : ""}`,
      ...r.steps.map((s, i) => `  ${i + 1}. ${s.status}${s.note ? `: ${s.note}` : ""}${s.redone ? ` (its recording failed: ${s.redone})` : ""}${s.by === "llm" && s.did.length ? ` (did: ${s.did.join("; ")})` : ""}`),
      ...(r.cleanup.length ? [`  Cleanup: ${r.cleanup.map((c, i) => `${i + 1}. ${c.status}${c.note ? `: ${c.note}` : ""}`).join("; ")}`] : []),
      "",
    ]),
    input.problems.length ? `Problems with the app already written down:\n${input.problems.map((f, i) => `${i + 1}. ${f.what}: ${f.saw}`).join("\n")}\n` : "",
    input.earlier.length ? `Earlier repairs of this test:\n${input.earlier.map((e) => `- ${e}`).join("\n")}\n` : "",
    latest.steps[line]?.page ? `The page at line ${line + 1} in the latest run, as text:\n${latest.steps[line]!.page}\n` : "",
    input.objection
      ? `Line ${line + 1} fails on every run and was left to fail as a fault of the app. Someone who didn't write the test looked again and didn't agree: ${input.objection}\nSo the test may not be kept failing on this. Verdict "test": reword this line, and those after it that hang on it, around what a user is entitled to and the page can answer, or take out what can't be saved. Verdict "cant-tell" when nothing of the goal is left to test without it.\n`
      : "",
    `Decide line ${line + 1}.${input.flips ? " It passed in an earlier run of the test as it is worded now." : ""}${png ? " The picture is the page at that line in the latest run." : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
  return llm.structured({ system: SYSTEM, prompt, images, schema: Repair, name: "repair" });
}

/** The test with a repair's edits made, or what is wrong with them. Lines that aren't touched keep their recordings. */
export function applyRepair(test: Test, fix: Repair): { test: Test } | { wrong: string } {
  const steps = [...test.steps];
  // From the bottom up, so the numbers still mean the lines they were given for.
  for (const edit of [...fix.edits].sort((a, b) => b.line - a.line)) {
    const at = edit.line - 1;
    if (at >= steps.length + (edit.op === "insert-before" ? 1 : 0)) return { wrong: `There is no line ${edit.line}.` };
    if (edit.op === "remove") {
      steps.splice(at, 1);
      continue;
    }
    if (!edit.with) return { wrong: `The ${edit.op} at line ${edit.line} has no line to put in.` };
    if (edit.with.type === "check" && edit.with.by === "code" && !edit.with.expect) return { wrong: `The check for line ${edit.line} is by code with no expect.` };
    const line = asLine(edit.with);
    const old = steps[at];
    // The same action in the same words keeps what was recorded for it.
    const kept = edit.op === "replace" && old?.type === "action" && old.by === "code" && line.type === "action" && line.by === "code" && old.do === line.do ? old : line;
    steps.splice(at, edit.op === "replace" ? 1 : 0, kept);
  }
  const values = fix.values ? Object.fromEntries(fix.values.map(({ name, ...range }) => [name, range])) : test.values;
  const made: Test = { ...test, values, steps };
  if (!made.steps.some((s) => s.type === "action")) return { wrong: "No action is left." };
  if (!made.steps.some((s) => s.type === "check")) return { wrong: "No check is left." };
  const wrong = wrongValues(made);
  return wrong ? { wrong } : { test: made };
}
