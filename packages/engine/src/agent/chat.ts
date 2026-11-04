/**
 * The assistant in the side panel. It answers about the app's tests and acts
 * on them through tools the caller supplies (the worker's database tools),
 * and can send a browser off to look at the app.
 */
import { z } from "zod";
import type { AppMap } from "@dappdrill/core";
import type { AgentTool, DrillSession, Inbox, Llm } from "../types.js";
import { formatSnapshot, takeSnapshot } from "./snapshot.js";
import { browserTools, Recorder } from "./tools.js";

export const CHAT_SYSTEM = `You are the assistant in DappDrill, where developers keep end-to-end tests for their web app (often a web3 dApp, tested with an injected wallet on a local fork).
Tests belong to flows. Each has a goal, an expected result and short plain-English steps. Unhappy paths run a test's steps under a wallet or network condition (rejected in wallet, slow RPC, wrong network…).

- Act with the tools rather than explaining how to click around. After acting, say in one short sentence what you did.
- Answer in at most three short sentences. No headings, no lists unless asked, no filler.
- Use browse when you need to see the app itself; it is slower, so not for what the tests already tell you.
- When something is unclear, ask one short question.`;

export interface ChatInput {
  message: string;
  history: { role: "user" | "agent"; text: string }[];
  appUrl: string;
  map?: AppMap;
  /** Where the developer is, e.g. "Viewing test “Market buy” (t_123) in flow “Trade perps”". */
  context?: string;
  tools: AgentTool[];
  /** Looks at the app in a browser and reports back. */
  browse?: (task: string) => Promise<string>;
  signal?: AbortSignal;
  onText?: (text: string) => void;
}

export async function chat(llm: Llm, input: ChatInput): Promise<string> {
  const tools = [...input.tools];
  if (input.browse) {
    const browse = input.browse;
    tools.push({
      name: "browse",
      description: "Open the app in a browser and do a short task there, e.g. 'Check what the Trade page shows before the wallet connects'. Returns what was seen.",
      schema: z.object({ task: z.string() }),
      handler: async ({ task }) => browse(task),
    });
  }
  const prompt = [
    `App: ${input.appUrl}`,
    input.map ? `About the app: ${input.map.summary}` : "",
    input.context ? `The developer is ${input.context}.` : "",
    input.history.length ? `\nConversation so far:\n${input.history.slice(-12).map((m) => `${m.role === "user" ? "Developer" : "You"}: ${m.text}`).join("\n")}` : "",
    `\nDeveloper: ${input.message}`,
  ].filter(Boolean).join("\n");
  const res = await llm.runAgent({ system: CHAT_SYSTEM, prompt, tools, maxTurns: 12, signal: input.signal, onText: input.onText });
  return res.text.trim();
}

const BROWSE_SYSTEM = `You look at a web app in a browser for a colleague and report back. Do the task with as few actions as you can, then call report with two or three plain sentences about what you saw. Don't send transactions. Never solve a CAPTCHA or bot check.`;

export async function browseTask(session: DrillSession, llm: Llm, task: string, opts: { map?: AppMap; inbox?: Inbox; signal?: AbortSignal } = {}): Promise<string> {
  let report: string | undefined;
  const tools: AgentTool[] = [
    ...browserTools({ session, recorder: new Recorder(session), inbox: opts.inbox }),
    {
      name: "report",
      description: "Report what you saw. Ends the task.",
      schema: z.object({ text: z.string() }),
      handler: async ({ text }) => {
        report = text;
        return "Done.";
      },
    },
  ];
  const snap = formatSnapshot(await takeSnapshot(session.page, { maxChars: 8_000 }));
  const prompt = [
    opts.map ? `About the app: ${opts.map.summary}\nPages:\n${opts.map.pages.map((p) => `- ${p.path}: ${p.purpose}`).join("\n")}\n` : "",
    `Task: ${task}`,
    "",
    "The page now:",
    snap,
  ].filter(Boolean).join("\n");
  const res = await llm.runAgent({ system: BROWSE_SYSTEM, prompt, tools, maxTurns: 15, signal: opts.signal });
  return report ?? (res.text.trim() || "Couldn't finish looking.");
}
