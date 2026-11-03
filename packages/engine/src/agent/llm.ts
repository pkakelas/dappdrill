/**
 * `createLlm()` picks the backend: the Anthropic SDK when ANTHROPIC_API_KEY is
 * set, otherwise the Claude Agent SDK, which uses the local Claude Code login.
 * Both implement `Llm` from types.ts.
 */
import type { Llm } from "../types.js";
import { createApiLlm } from "./llm-api.js";
import { createAgentSdkLlm } from "./llm-agent-sdk.js";
import { DEFAULT_ACT_MODEL, DEFAULT_MODEL, type Effort } from "./llm-common.js";

export { LlmError, type LlmErrorCode, type Effort } from "./llm-common.js";

export interface LlmOptions {
  /**
   * "think" (default) plans, reviews and repairs: DAPPDRILL_MODEL, else Opus.
   * "act" carries out a plan step by step: DAPPDRILL_ACT_MODEL, else Sonnet.
   */
  role?: "think" | "act";
  /** Overrides the role's model. */
  model?: string;
  backend?: "api" | "agent-sdk";
  apiKey?: string;
  /** Effort for agent loops (default medium). Structured calls always run at low effort. */
  effort?: Effort;
}

export function createLlm(opts: LlmOptions = {}): Llm {
  const model =
    opts.model ?? (opts.role === "act" ? (process.env.DAPPDRILL_ACT_MODEL ?? DEFAULT_ACT_MODEL) : (process.env.DAPPDRILL_MODEL ?? DEFAULT_MODEL));
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const backend = opts.backend ?? (apiKey ? "api" : "agent-sdk");
  const effort = opts.effort ?? "medium";
  return backend === "api" ? createApiLlm({ model, apiKey, effort }) : createAgentSdkLlm({ model, effort });
}
