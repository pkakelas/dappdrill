/**
 * After an edge case (rejected signature, wrong network, slow RPC…) the replay
 * asks the model one cheap question: did the app recover and tell the user
 * what happened? Deterministic checks run first; this adds the plain verdict.
 */
import { z } from "zod";
import type { Llm, RecoveryJudge } from "../types.js";

const Verdict = z.object({
  ok: z.boolean().describe("true when the app handled the situation acceptably"),
  explanation: z.string().describe("One or two sentences a developer can act on"),
});

const SYSTEM = `You judge how a web3 dApp's UI handled a condition (a rejected signature, a slow RPC, the wrong network…). You get a screenshot and the visible text after the event.
Say ok=true only if the app is in a sane state (no spinner stuck forever, no blank screen, no raw error dump) AND the user can tell what happened and what to do next.
Be concrete: name the text or element that shows the outcome, or what is missing.`;

export function createRecoveryJudge(llm: Llm): RecoveryJudge {
  return {
    async judge({ edgeCase, expected, screenshot, pageText }) {
      const prompt = [
        `Condition: ${edgeCase}`,
        `The app should: ${expected}`,
        "",
        "Visible page text:",
        pageText.slice(0, 4000),
      ].join("\n");
      return llm.structured({ system: SYSTEM, prompt, images: [screenshot], schema: Verdict, name: "recovery_verdict" });
    },
  };
}
