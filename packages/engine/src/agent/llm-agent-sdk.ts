/**
 * Llm backend on the Claude Agent SDK, used when there is no API key: it runs
 * on the local Claude Code login. Our AgentTools are exposed through an
 * in-process MCP server; every built-in tool is disabled. Cost comes from the
 * SDK's result message, or from each answer's token counts when a run is cut
 * off before it gets one.
 */
import { createSdkMcpServer, query, tool, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentTool, ImageInput, Llm } from "../types.js";
import { LlmError, costOf, runTool, shapeOf, type Effort } from "./llm-common.js";

const SERVER = "dappdrill";

/**
 * What one call may spend and how long it may take. A call that runs away (a page too big for the
 * model, a Claude Code subprocess that hangs) is stopped and ends as an LlmError. An agent's budget grows
 * with its turns: a look of 50 turns normally spends about $1, an action of 12 a few cents.
 */
const AGENT_USD_PER_TURN = 0.08;
const AGENT_MIN_USD = 0.75;
const STRUCTURED_BUDGET_USD = 1;
const AGENT_TIMEOUT_MS = 5 * 60_000;
const STRUCTURED_TIMEOUT_MS = 4 * 60_000;

/** The MCP SDK is not a direct dependency; take the result type from `tool()` itself. */
type CallToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export function createAgentSdkLlm(opts: { model: string; effort: Effort }): Llm {
  let cost = 0;

  const baseOptions = (system: string, maxBudgetUsd: number): Options => ({
    model: opts.model,
    systemPrompt: system,
    tools: [],
    settingSources: [],
    persistSession: false,
    thinking: { type: "adaptive" },
    effort: opts.effort,
    permissionMode: "default",
    maxBudgetUsd,
    // Tool names may or may not carry the mcp__dappdrill__ prefix depending on
    // the environment, so allow everything: the only tools that exist are ours.
    canUseTool: async () => ({ behavior: "allow" }),
    // A Claude Code session marks its environment; drop the mark so the
    // subprocess does not think it is nested inside one. A conversation that
    // overflows should fail, not compact itself over and over.
    env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined, DISABLE_AUTO_COMPACT: "1" },
  });

  /** Runs one query and returns its result message, tracking cost. */
  const run = async (
    options: Options,
    prompt: string,
    images: ImageInput[] | undefined,
    limits: { signal?: AbortSignal; timeoutMs: number; onText?: (text: string) => void },
  ): Promise<{ text: string; subtype: string; structured?: unknown }> => {
    const { signal, timeoutMs, onText } = limits;
    const abortController = new AbortController();
    const stop = () => abortController.abort();
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
    const cut = (cause?: unknown) =>
      signal?.aborted
        ? new LlmError("aborted", "Model call aborted", { cause })
        : timedOut
          ? new LlmError("timeout", `The model gave no answer in ${Math.round(timeoutMs / 60_000)} minutes`, { cause })
          : undefined;

    const q = query({ prompt: promptFor(prompt, images), options: { ...options, abortController } });
    let lastText = "";
    // One answer arrives as several messages with the same id and the same counts.
    const answers = new Map<string, number>();
    const spentSoFar = () => {
      cost += [...answers.values()].reduce((a, b) => a + b, 0);
      answers.clear();
    };
    try {
      for await (const msg of q) {
        if (msg.type === "assistant") {
          const u = msg.message.usage;
          answers.set(msg.message.id, costOf(opts.model, { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }));
        }
        if (msg.type === "assistant" && msg.parent_tool_use_id === null) {
          const text = msg.message.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n")
            .trim();
          if (text) {
            lastText = text;
            onText?.(text);
          }
        } else if (msg.type === "result") {
          // The result's total covers every answer, so the counts kept so far aren't added again.
          answers.clear();
          cost += msg.total_cost_usd;
          if (msg.subtype === "success" && !msg.is_error) {
            return { text: msg.result || lastText, subtype: msg.subtype, structured: msg.structured_output };
          }
          if (msg.subtype === "error_max_budget_usd") throw new LlmError("budget", `The call went over its $${options.maxBudgetUsd} budget`);
          // A session that broke (an API error, a context that overflowed) is an error, not an answer.
          if (msg.subtype === "success" || msg.subtype === "error_during_execution") {
            const said = msg.subtype === "success" ? msg.result : msg.errors.join("; ");
            throw cut() ?? new LlmError("api", `Agent run failed: ${said || msg.subtype}`);
          }
          return { text: lastText, subtype: msg.subtype };
        }
      }
    } catch (err) {
      spentSoFar();
      if (err instanceof LlmError) throw err;
      throw cut(err) ?? new LlmError("api", err instanceof Error ? err.message : String(err), { cause: err });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    }
    spentSoFar();
    throw cut() ?? new LlmError("api", "The agent session ended without a result");
  };

  return {
    backend: "agent-sdk",
    model: opts.model,
    costUsd: () => cost,

    async runAgent({ system, prompt, images, tools, maxTurns, signal, onText }) {
      const server = createSdkMcpServer({ name: SERVER, tools: tools.map(mcpTool) });
      const options: Options = { ...baseOptions(system, Math.max(AGENT_MIN_USD, maxTurns * AGENT_USD_PER_TURN)), mcpServers: { [SERVER]: server }, maxTurns };
      const res = await run(options, prompt, images, { signal, timeoutMs: Math.max(AGENT_TIMEOUT_MS, maxTurns * 10_000), onText });
      if (res.subtype === "success") return { text: res.text, stopReason: "end_turn" };
      if (res.subtype === "error_max_turns") return { text: res.text, stopReason: "max_turns" };
      throw new LlmError("api", `Agent run failed: ${res.subtype}`);
    },

    async structured({ system, prompt, images, schema, signal }) {
      const options: Options = {
        ...baseOptions(system, STRUCTURED_BUDGET_USD),
        maxTurns: 1,
        outputFormat: { type: "json_schema", schema: jsonSchema(schema) },
      };
      let lastError: string | undefined;
      // The SDK validates against the JSON schema; zod adds refinements, so retry once with the error.
      // It also runs out of its one turn now and then, which a second try gets past.
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = lastError ? `${prompt}\n\nYour previous answer was invalid: ${lastError}\nAnswer again.` : prompt;
        const res = await run(options, text, images, { signal, timeoutMs: STRUCTURED_TIMEOUT_MS });
        if (res.subtype !== "success") {
          lastError = `No structured output (${res.subtype})`;
          continue;
        }
        const json = res.structured ?? safeJson(res.text);
        if (json === undefined) {
          lastError = `It wasn't JSON: ${res.text.slice(0, 200)}`;
          continue;
        }
        const parsed = schema.safeParse(json);
        if (parsed.success) return parsed.data;
        lastError = parsed.error.message;
      }
      throw new LlmError("invalid_output", lastError ?? "Invalid structured output");
    },
  };
}

function mcpTool(t: AgentTool) {
  return tool(t.name, t.description, shapeOf(t), async (args): Promise<CallToolResult> => {
    const { result, isError } = await runTool(t, args);
    const content: CallToolResult["content"] = [{ type: "text", text: result.text }];
    if (result.image) content.push({ type: "image", data: result.image.data, mimeType: result.image.mediaType });
    return { content, isError: isError || undefined };
  });
}

function promptFor(prompt: string, images: ImageInput[] | undefined): string | AsyncIterable<SDKUserMessage> {
  if (!images?.length) return prompt;
  const message: SDKUserMessage = {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        ...images.map((img) => ({
          type: "image" as const,
          source: { type: "base64" as const, media_type: img.mediaType, data: img.data },
        })),
        { type: "text", text: prompt },
      ],
    },
  };
  return (async function* () {
    yield message;
  })();
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
