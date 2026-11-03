/** Pieces shared by both Llm backends: errors, pricing, tool plumbing. */
import type { ZodObject, ZodType } from "zod";
import type { AgentTool, AgentToolResult } from "../types.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Plans, reviews and repairs. */
export const DEFAULT_MODEL = "claude-opus-5-5";
/** Clicks through flows a plan already describes. */
export const DEFAULT_ACT_MODEL = "claude-sonnet-5-5";

export type LlmErrorCode = "refusal" | "max_tokens" | "max_turns" | "aborted" | "invalid_output" | "api";

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

/** Validate the model's input and run the tool; errors become text the model can act on. */
export async function runTool(tool: AgentTool, input: unknown): Promise<{ result: AgentToolResult; isError: boolean }> {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return { result: { text: `Invalid input for ${tool.name}: ${parsed.error.message}` }, isError: true };
  }
  try {
    const out = await tool.handler(parsed.data);
    return { result: typeof out === "string" ? { text: out } : out, isError: false };
  } catch (err) {
    return { result: { text: `${tool.name} failed: ${err instanceof Error ? err.message : String(err)}` }, isError: true };
  }
}

/** Pull a JSON object out of a text reply (plain or fenced). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) throw new LlmError("invalid_output", "No JSON object in the reply");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    throw new LlmError("invalid_output", `Reply is not valid JSON: ${(err as Error).message}`);
  }
}
