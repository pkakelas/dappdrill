/**
 * An explorer hands over a test with what it actually did in the browser. Lining those actions up
 * with the test's plain steps lets the proof replay them, so the model only works on a step whose
 * replay breaks.
 */
import { describeStep, type Step, type TestDraft, type TestStep } from "@dappdrill/core";
import { z } from "zod";
import type { Llm } from "../types.js";

/** A longer recording is an explorer wandering, and not worth replaying. */
const MAX_ACTIONS = 60;

const Lined = z.object({ steps: z.array(z.number().int().min(0)).describe("For each action in order, the number of the step it carries out; 0 when it belongs to none") });

const SYSTEM = `You match what someone did in a web app to the written steps of a test. You get the steps, numbered, and the recorded actions in the order they happened. For each action give the number of the step it carries out. Actions happen in step order, so the numbers never go down. Give 0 for an action that belongs to no step: a detour, a repeat, something that was undone. A step may have no action.`;

export async function lineUp(llm: Llm, draft: Pick<TestDraft, "name" | "steps">, actions: Step[]): Promise<TestStep[] | undefined> {
  if (actions.length === 0 || actions.length > MAX_ACTIONS) return undefined;
  const out = await llm.structured({
    system: SYSTEM,
    prompt: [`Test: ${draft.name}`, `Steps:\n${draft.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`, `Actions:\n${actions.map((a, i) => `${i + 1}. ${describeStep(a)}`).join("\n")}`].join("\n\n"),
    schema: Lined,
    name: "line_up",
  });
  return assign(draft.steps, actions, out.steps);
}

/**
 * The steps with their actions, or nothing when the answer doesn't fit: one number per action, in
 * step order. A step no action belongs to keeps none, and is done by the model.
 */
export function assign(texts: string[], actions: Step[], owners: number[]): TestStep[] | undefined {
  if (owners.length !== actions.length) return undefined;
  const kept = owners.filter((o) => o > 0);
  if (kept.length === 0 || kept.some((o, i) => o > texts.length || (i > 0 && o < kept[i - 1]!))) return undefined;
  return texts.map((text, i) => {
    const mine = actions.filter((_, at) => owners[at] === i + 1);
    return mine.length ? { text, actions: mine } : { text };
  });
}
