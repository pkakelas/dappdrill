/**
 * Llm backend on the Claude Agent SDK, used when there is no API key: it runs
 * on the local Claude Code login. Our AgentTools are exposed through an
 * in-process MCP server; every built-in tool is disabled. Cost comes from the
 * SDK's result message.
 */
import { createSdkMcpServer, query, tool, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AgentTool, ImageInput, Llm } from "../types.js";
import { LlmError, runTool, shapeOf, type Effort } from "./llm-common.js";

const SERVER = "dappdrill";

/** The MCP SDK is not a direct dependency; take the result type from `tool()` itself. */
type CallToolResult = Awaited<ReturnType<Parameters<typeof tool>[3]>>;

export function createAgentSdkLlm(opts: { model: string; effort: Effort }): Llm {
  let cost = 0;

  const baseOptions = (system: string, signal?: AbortSignal): Options => {
    const abortController = new AbortController();
    if (signal?.aborted) abortController.abort();
    signal?.addEventListener("abort", () => abortController.abort(), { once: true });
    return {
      model: opts.model,
      systemPrompt: system,
      tools: [],
      settingSources: [],
      persistSession: false,
      thinking: { type: "adaptive" },
      effort: opts.effort,
      permissionMode: "default",
      // Tool names may or may not carry the mcp__dappdrill__ prefix depending on
      // the environment, so allow everything: the only tools that exist are ours.
      canUseTool: async () => ({ behavior: "allow" }),
      abortController,
      // A Claude Code session marks its environment; drop the mark so the
      // subprocess does not think it is nested inside one.
      env: { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined },
    };
  };

  /** Runs one query and returns its result message, tracking cost. */
  const run = async (
    options: Options,
    prompt: string,
    images: ImageInput[] | undefined,
    onText?: (text: string) => void,
  ): Promise<{ text: string; subtype: string; structured?: unknown }> => {
    const q = query({ prompt: promptFor(prompt, images), options });
    let lastText = "";
    try {
      for await (const msg of q) {
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
          cost += msg.total_cost_usd;
          if (msg.subtype === "success") {
            return { text: msg.result || lastText, subtype: msg.subtype, structured: msg.structured_output };
          }
          return { text: lastText, subtype: msg.subtype };
        }
      }
    } catch (err) {
      if (options.abortController?.signal.aborted) throw new LlmError("aborted", "Model call aborted", { cause: err });
      throw new LlmError("api", err instanceof Error ? err.message : String(err), { cause: err });
    }
    if (options.abortController?.signal.aborted) throw new LlmError("aborted", "Model call aborted");
    throw new LlmError("api", "The agent session ended without a result");
  };

  return {
    backend: "agent-sdk",
    costUsd: () => cost,

    async runAgent({ system, prompt, images, tools, maxTurns, signal, onText }) {
      const server = createSdkMcpServer({ name: SERVER, tools: tools.map(mcpTool) });
      const options: Options = { ...baseOptions(system, signal), mcpServers: { [SERVER]: server }, maxTurns };
      const res = await run(options, prompt, images, onText);
      if (res.subtype === "success") return { text: res.text, stopReason: "end_turn" };
      if (res.subtype === "error_max_turns") return { text: res.text, stopReason: "max_turns" };
      throw new LlmError("api", `Agent run failed: ${res.subtype}`);
    },

    async structured({ system, prompt, images, schema }) {
      const options: Options = {
        ...baseOptions(system),
        maxTurns: 1,
        outputFormat: { type: "json_schema", schema: jsonSchema(schema) },
      };
      let lastError: string | undefined;
      // The SDK validates against the JSON schema; zod adds refinements, so retry once with the error.
      for (let attempt = 0; attempt < 2; attempt++) {
        const text = lastError ? `${prompt}\n\nYour previous answer was invalid: ${lastError}\nAnswer again.` : prompt;
        const res = await run(options, text, images);
        if (res.subtype !== "success") throw new LlmError("invalid_output", `No structured output (${res.subtype})`);
        const parsed = schema.safeParse(res.structured ?? safeJson(res.text));
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
