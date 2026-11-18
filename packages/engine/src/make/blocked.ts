/**
 * Whether something that stopped an earlier goal, or a fault a kept test fails on, would stop the next
 * goal too, so it isn't tried for nothing. One short question to a model, with no page.
 */
import { z } from "zod";
import type { Llm } from "../types.js";
import type { StoppedBy } from "./each.js";

const Answer = z.object({
  why: z.string(),
  stopped: z.number().int().min(0).describe("The number of the thing that would stop this goal too, or 0 when none would"),
});

const SYSTEM = `Tests are being made for a web app, one goal at a time. Some things stop goals: something in the way of an earlier goal that isn't the app's fault, or a fault of the app that a test already kept fails on every time. You decide whether one of those would stop the next goal as well, so it isn't tried for nothing.

Say it would only when the goal can't be done without going through it: the same kind of order on markets that don't fill, the same service that is down, the same account state, the same broken step of the app before the goal gets to what it is about. A goal that only reads, that a user would do another way, or whose point comes before the fault, isn't stopped. When unsure, it isn't.`;

export function stoppedBy(llm: Llm): StoppedBy {
  return async (goal, stoppers) => {
    const prompt = [`The next goal: ${goal}`, "", "What stops goals:", ...stoppers.map((b, i) => `${i + 1}. ${b}`)].join("\n");
    const { stopped } = await llm.structured({ system: SYSTEM, prompt, schema: Answer, name: "stopped_by" });
    return stopped >= 1 && stopped <= stoppers.length ? stopped - 1 : undefined;
  };
}
