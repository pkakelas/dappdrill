/**
 * `createLlm()` picks the backend: the Anthropic SDK when ANTHROPIC_API_KEY is
 * set, otherwise the Claude Agent SDK, which uses the local Claude Code login.
 * Both implement `Llm` from types.ts.
 */
import type { Llm } from "../types.js";
import { createApiLlm } from "./llm-api.js";
import { createAgentSdkLlm } from "./llm-agent-sdk.js";
import { DEFAULT_ACT_MODEL, DEFAULT_FAST_MODEL, DEFAULT_MODEL, type Effort } from "./llm-common.js";

export { LlmError, type LlmErrorCode, type Effort } from "./llm-common.js";

export interface LlmOptions {
  /**
   * "think" (default) analyzes apps: DAPPDRILL_MODEL, else Opus.
   * "act" takes over steps the fast model couldn't do: DAPPDRILL_ACT_MODEL, else Opus.
   * "fast" runs test steps, judges results and writes tests: DAPPDRILL_FAST_MODEL, else Sonnet.
   */
  role?: "think" | "act" | "fast";
  /** Overrides the role's model. */
  model?: string;
  backend?: "api" | "agent-sdk";
  apiKey?: string;
  /** Effort for every call (default medium). */
  effort?: Effort;
}

export function createLlm(opts: LlmOptions = {}): Llm {
  const byRole = {
    think: () => process.env.DAPPDRILL_MODEL ?? DEFAULT_MODEL,
    act: () => process.env.DAPPDRILL_ACT_MODEL ?? DEFAULT_ACT_MODEL,
    fast: () => process.env.DAPPDRILL_FAST_MODEL ?? DEFAULT_FAST_MODEL,
  };
  const model = opts.model ?? byRole[opts.role ?? "think"]();
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const backend = opts.backend ?? (apiKey ? "api" : "agent-sdk");
  const effort = opts.effort ?? "medium";
  return backend === "api" ? createApiLlm({ model, apiKey, effort }) : createAgentSdkLlm({ model, effort });
}
