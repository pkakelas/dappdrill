/** Pieces shared by both Llm backends: errors, pricing, tool plumbing. */
import type { ZodObject, ZodType } from "zod";
import type { AgentTool, AgentToolResult } from "../types.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Looks around an app, and takes the second look at a test that fails. */
export const DEFAULT_MODEL = "claude-opus-5-5";
/** Writes and repairs tests, judges checks, and takes over an action the quick model couldn't do. */
export const DEFAULT_FAST_MODEL = "claude-sonnet-5-5";
/** Does a test's model actions first; the fast model gets the ones it can't do. */
export const DEFAULT_QUICK_MODEL = "claude-haiku-5-5";

export type LlmErrorCode = "refusal" | "max_tokens" | "max_turns" | "aborted" | "timeout" | "budget" | "invalid_output" | "api";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmError";
  }
}

/** USD per million tokens. Unknown models are priced like Opus. */
const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costOf(
  model: string,
  usage: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): number {
  const p = PRICES[model] ?? PRICES[DEFAULT_MODEL]!;
  return (
    (usage.input * p.in + usage.output * p.out + (usage.cacheRead ?? 0) * p.cacheRead + (usage.cacheWrite ?? 0) * p.cacheWrite) /
    1_000_000
  );
}

/** Our tools are always z.object schemas; the Agent SDK needs the raw shape. */
export function shapeOf(tool: AgentTool): ZodObject["shape"] {
  const schema = tool.schema as ZodType & { shape?: ZodObject["shape"] };
  if (!schema.shape) throw new Error(`Tool "${tool.name}" needs a z.object() schema`);
  return schema.shape;
}

/** The most text one tool result gives a model. A page snapshot is far less; more would fill a model's context in a few turns. */
export const TOOL_TEXT_CHARS = 30_000;

/** Validate the model's input and run the tool; errors become text the model can act on. */
export async function runTool(tool: AgentTool, input: unknown): Promise<{ result: AgentToolResult; isError: boolean }> {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return { result: { text: `Invalid input for ${tool.name}: ${parsed.error.message}` }, isError: true };
  }
  try {
    const out = await tool.handler(parsed.data);
    return { result: capped(tool.name, typeof out === "string" ? { text: out } : out), isError: false };
  } catch (err) {
    return { result: { text: `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}` }, isError: true };
  }
}


/** A tool result within TOOL_TEXT_CHARS. One over it is a fault of ours, so it is said where the worker logs it. */
function capped(name: string, result: AgentToolResult): AgentToolResult {
  if (result.text.length <= TOOL_TEXT_CHARS) return result;
  console.warn(`[engine] the ${name} tool returned ${result.text.length} characters; cut to ${TOOL_TEXT_CHARS}. It began: ${result.text.slice(0, 300).replace(/\s+/g, " ")}`);
  return { ...result, text: `${result.text.slice(0, TOOL_TEXT_CHARS)}\n… cut here: the rest was too long to show.` };
}
