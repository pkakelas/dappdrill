/**
 * Llm backend on the Anthropic SDK (ANTHROPIC_API_KEY). Manual tool loop with
 * adaptive thinking, prompt caching on tools + system and on the latest turn,
 * typed stop-reason handling and a running cost estimate from usage.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { AgentToolResult, ImageInput, Llm } from "../types.js";
import { LlmError, costOf, runTool, type Effort } from "./llm-common.js";

const MAX_TOKENS = 16000;

export function createApiLlm(opts: { model: string; apiKey?: string; effort: Effort }): Llm {
  const client = new Anthropic({ apiKey: opts.apiKey });
  let cost = 0;

  const track = (usage: Anthropic.Usage) => {
    cost += costOf(opts.model, {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0,
    });
  };

  const call = async <T extends Anthropic.MessageCreateParamsNonStreaming>(params: T, signal?: AbortSignal) => {
    try {
      return await client.messages.create(params, { signal });
    } catch (err) {
      if (signal?.aborted) throw new LlmError("aborted", "Model call aborted", { cause: err });
      if (err instanceof Anthropic.APIError) throw new LlmError("api", `${err.status ?? ""} ${err.message}`.trim(), { cause: err });
      throw err;
    }
  };

  return {
    backend: "api",
    costUsd: () => cost,

    async runAgent({ system, prompt, images, tools, maxTurns, signal, onText }) {
      const toolDefs: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: inputSchema(t.schema),
      }));
      const byName = new Map(tools.map((t) => [t.name, t]));
      const messages: Anthropic.MessageParam[] = [
        { role: "user", content: [...(images ?? []).map(imageBlock), { type: "text", text: prompt }] },
      ];
      markCache(messages);
      let lastText = "";

      for (let turn = 0; turn < maxTurns; turn++) {
        const res = await call(
          {
            model: opts.model,
            max_tokens: MAX_TOKENS,
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            tools: toolDefs,
            thinking: { type: "adaptive" },
            output_config: { effort: opts.effort },
            messages,
          },
          signal,
        );
        track(res.usage);

        const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        if (text) {
          lastText = text;
          onText?.(text);
        }
        if (res.stop_reason === "refusal") {
          throw new LlmError("refusal", res.stop_details?.explanation ?? "The model declined this request");
        }
        if (res.stop_reason === "max_tokens") {
          throw new LlmError("max_tokens", "The reply hit the output token limit");
        }

        messages.push({ role: "assistant", content: res.content });
        if (res.stop_reason === "pause_turn") continue;

        const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (uses.length === 0) return { text: lastText, stopReason: "end_turn" };

        const results = await Promise.all(
          uses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
            const tool = byName.get(use.name);
            if (!tool) return { type: "tool_result", tool_use_id: use.id, content: `Unknown tool ${use.name}`, is_error: true };
            const { result, isError } = await runTool(tool, use.input);
            return { type: "tool_result", tool_use_id: use.id, content: resultContent(result), is_error: isError || undefined };
          }),
        );
        messages.push({ role: "user", content: results });
        markCache(messages);
      }
      return { text: lastText, stopReason: "max_turns" };
    },

    async structured({ system, prompt, images, schema }) {
      const res = await call({
        model: opts.model,
        max_tokens: MAX_TOKENS,
        system,
        thinking: { type: "adaptive" },
        output_config: { effort: opts.effort, format: zodOutputFormat(schema as unknown as z.ZodType) },
        messages: [{ role: "user", content: [...(images ?? []).map(imageBlock), { type: "text", text: prompt }] }],
      });
      track(res.usage);
      if (res.stop_reason === "refusal") throw new LlmError("refusal", res.stop_details?.explanation ?? "The model declined");
      if (res.stop_reason === "max_tokens") throw new LlmError("max_tokens", "The reply hit the output token limit");
      const text = res.content.find((b) => b.type === "text")?.text ?? "";
      const parsed = schema.safeParse(JSON.parse(text));
      if (!parsed.success) throw new LlmError("invalid_output", parsed.error.message);
      return parsed.data;
    },
  };
}

function inputSchema(schema: z.ZodType): Anthropic.Tool.InputSchema {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema as z.ZodType) as Record<string, unknown>;
  return json as Anthropic.Tool.InputSchema;
}

function imageBlock(img: ImageInput): Anthropic.ImageBlockParam {
  return { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } };
}

function resultContent(result: AgentToolResult): Anthropic.ToolResultBlockParam["content"] {
  if (!result.image) return result.text;
  return [{ type: "text", text: result.text }, imageBlock(result.image)];
}

/** Keep one moving cache breakpoint on the latest user turn (plus the one on system). */
function markCache(messages: Anthropic.MessageParam[]) {
  for (const m of messages) {
    if (m.role !== "user" || typeof m.content === "string") continue;
    for (const block of m.content) delete (block as { cache_control?: unknown }).cache_control;
  }
  const last = messages.at(-1);
  if (!last || last.role !== "user" || typeof last.content === "string") return;
  const block = last.content.at(-1);
  if (block && block.type !== "server_tool_use") (block as { cache_control?: unknown }).cache_control = { type: "ephemeral" };
}
