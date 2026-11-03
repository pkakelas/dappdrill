/** An Llm that plays a fixed script of tool calls: deterministic agent tests without spend. */
import type { AgentTool, Llm } from "../../../src/types.js";

export type ScriptStep =
  | { tool: string; input?: unknown }
  | ((lastResult: string, page: string) => { tool: string; input?: unknown });

export interface ScriptedLlm extends Llm {
  /** Every tool result text, in order. */
  readonly results: string[];
}

/** Plays the whole script on every runAgent call. */
export function scriptedLlm(script: ScriptStep[], finalText = "done"): ScriptedLlm {
  return scripted(() => script, finalText);
}

/** Plays `runs[i]` on the i-th runAgent call, and nothing after the last. */
export function scriptedRuns(runs: ScriptStep[][], finalText = "done"): ScriptedLlm {
  let call = 0;
  return scripted(() => runs[call++] ?? [], finalText);
}

function scripted(next: () => ScriptStep[], finalText: string): ScriptedLlm {
  const results: string[] = [];
  return {
    backend: "api",
    results,
    costUsd: () => 0,
    async runAgent({ tools, maxTurns }) {
      let last = "";
      for (const [i, entry] of next().entries()) {
        if (i >= maxTurns) return { text: "turns exhausted", stopReason: "max_turns" };
        // `page` is the latest tool result that contained a page snapshot.
        const page = [...results].reverse().find((r) => r.includes("\nURL: ") || r.startsWith("URL: ")) ?? "";
        const call = typeof entry === "function" ? entry(last, page) : entry;
        const tool = tools.find((t: AgentTool) => t.name === call.tool);
        if (!tool) throw new Error(`Scripted call to unknown tool ${call.tool}`);
        const parsed = tool.schema.safeParse(call.input ?? {});
        if (!parsed.success) throw new Error(`Bad input for ${call.tool}: ${parsed.error.message}`);
        const out = await tool.handler(parsed.data);
        last = typeof out === "string" ? out : out.text;
        results.push(last);
      }
      return { text: finalText, stopReason: "end_turn" };
    },
    async structured() {
      throw new Error("scripted Llm has no structured()");
    },
  };
}

/** Find the ref of a snapshot line like `[e5] button "Deposit"`. */
export function refOf(snapshotText: string, role: string, name: string): string {
  const re = new RegExp(`\\[(e\\d+)\\] ${role} "${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  const m = re.exec(snapshotText);
  if (!m) throw new Error(`No ${role} "${name}" in:\n${snapshotText}`);
  return m[1]!;
}
