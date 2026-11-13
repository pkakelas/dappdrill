/**
 * `createLlm()` picks the backend: the Anthropic SDK when ANTHROPIC_API_KEY is
 * set, otherwise the Claude Agent SDK, which uses the local Claude Code login.
 * Both implement `Llm` from types.ts.
 */
import type { Llm } from "../types.js";
import { createApiLlm } from "./llm-api.js";
import { createAgentSdkLlm } from "./llm-agent-sdk.js";
import { DEFAULT_FAST_MODEL, DEFAULT_MODEL, DEFAULT_QUICK_MODEL, type Effort } from "./llm-common.js";

export { LlmError, type LlmErrorCode, type Effort } from "./llm-common.js";

export interface LlmOptions {
  /**
   * "think" (default) looks around an app and takes the second look at a failing test: DAPPDRILL_MODEL, else Opus.
   * "fast" writes and repairs tests, judges checks, and takes over an action the quick model couldn't do: DAPPDRILL_FAST_MODEL, else Sonnet.
   * "quick" does a test's model actions first: DAPPDRILL_QUICK_MODEL, else Haiku.
   */
  role?: "think" | "fast" | "quick";
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
    fast: () => process.env.DAPPDRILL_FAST_MODEL ?? DEFAULT_FAST_MODEL,
    quick: () => process.env.DAPPDRILL_QUICK_MODEL ?? DEFAULT_QUICK_MODEL,
  };
  const model = opts.model ?? byRole[opts.role ?? "think"]();
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  const backend = opts.backend ?? (apiKey ? "api" : "agent-sdk");
  const effort = opts.effort ?? "medium";
  return backend === "api" ? createApiLlm({ model, apiKey, effort }) : createAgentSdkLlm({ model, effort });
}
