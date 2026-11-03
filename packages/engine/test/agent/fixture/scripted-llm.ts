/** An Llm that plays a fixed script of tool calls: deterministic agent tests without spend. */
import type { AgentTool, Llm } from "../../../src/types.js";

export type ScriptStep =
  | { tool: string; input?: unknown }
  | ((lastResult: string, page: string) => { tool: string; input?: unknown });

export interface ScriptedLlm extends Llm {
  /** Every tool result text, in order. */
  readonly results: string[];
}

export function scriptedLlm(script: ScriptStep[], finalText = "done"): ScriptedLlm {
  const results: string[] = [];
  return {
    backend: "api",
    results,
    costUsd: () => 0,
    async runAgent({ tools, maxTurns }) {
      let last = "";
      for (const [i, entry] of script.entries()) {
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
      throw new Error("scriptedLlm has no structured()");
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
