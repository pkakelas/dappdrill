/**
 * A repair from end to end, on the test dApp and a local Anvil, with a stand-in for the model: it does
 * the lines that have no code and answers the check that is only a sentence, and what comes back is a
 * test that a run does with no model at all.
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { DrillTarget, Suite, Test } from "@dappdrill/core";
import { createLlm } from "../../src/agent/index.js";
import { repairSuite, runSuite } from "../../src/api.js";
import type { AgentTool, Llm } from "../../src/types.js";
import { refOf } from "../agent/fixture/scripted-llm.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "../runtime/fixture.js";

vi.mock("../../src/agent/index.js", async (original) => ({ ...(await original<typeof import("../../src/agent/index.js")>()), createLlm: vi.fn() }));

let fx: Fixture;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-repaired-"));
}, 60_000);

afterAll(async () => {
  await fx?.close();
});

/** The actions it was given, by their sentences, and the structured answers it was asked for. */
const did: string[] = [];
const answered: string[] = [];

/** Does the action marked as its own the way a model would: looks, then clicks or types by ref. */
const model: Llm = {
  backend: "api",
  model: "stand-in",
  costUsd: () => 0,
  async runAgent({ prompt, tools }) {
    const call = async (name: string, input: object = {}) => {
      const tool = tools.find((t: AgentTool) => t.name === name)!;
      const out = await tool.handler(tool.schema.parse(input));
      return typeof out === "string" ? out : out.text;
    };
    const line = /^\d+\. (.*) {2}← this one$/m.exec(prompt)![1]!;
    did.push(line);
    if (line.startsWith("Connect")) {
      await call("click", { ref: refOf(await call("look"), "button", "Connect wallet") });
      await call("click", { ref: refOf(await call("look"), "button", "MetaMask") });
    } else {
      const amount = /^Type (\S+) into/.exec(line)![1]!;
      await call("type", { ref: refOf(await call("look"), "textbox", "Amount"), text: amount });
    }
    await call("done", { ok: true, reason: "Done." });
    return { text: "done", stopReason: "end_turn" };
  },
  async structured({ name }) {
    answered.push(name);
    if (name === "answer") return { answer: "yes", why: "The field holds it." } as never;
    if (name === "check") return { expect: { kind: "shows", text: "{{amount}}" } } as never;
    throw new Error(`Not asked for in this test: ${name}`);
  },
};

const drafted = Test.parse({
  id: "amount",
  name: "Type an amount",
  goal: "A connected user types an amount to deposit.",
  values: { amount: { from: 2, to: 9 } },
  steps: [
    { type: "action", by: "code", do: "Connect the wallet with MetaMask." },
    { type: "action", by: "code", do: "Type {{amount}} into Amount." },
    { type: "check", by: "llm", claim: "The Amount field holds {{amount}}." },
    { type: "check", by: "code", claim: "The wallet is connected.", expect: { kind: "shows", text: "via MetaMask" } },
  ],
});

it("repairs a test that isn't code yet, and a run then does it with no model", async () => {
  const target = DrillTarget.parse({ url: fx.pageUrl(), chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS, account: "kept" });
  vi.mocked(createLlm).mockImplementation(() => model);
  const said: string[] = [];
  const repaired = await repairSuite({ target, suite: Suite.parse({ tests: [drafted] }), artifactsDir }, () => {}, { say: (text) => void said.push(text) });

  expect(repaired.tests, said.join("\n")).toHaveLength(1);
  const { test, why } = repaired.tests[0]!;
  expect(why, said.join("\n")).toBeUndefined();
  // Each action was done once by the model, in the one run that had one; the sentence was answered and written as code once.
  expect(did.map((d) => d.replace(/\d+\.\d+/, "N"))).toEqual(["Connect the wallet with MetaMask.", "Type N into Amount."]);
  expect(answered).toEqual(["answer", "check"]);
  expect(test!.steps).toEqual([
    {
      type: "action",
      by: "code",
      do: "Connect the wallet with MetaMask.",
      // The clicks that connect a wallet are recorded as optional: an app that remembers the wallet doesn't ask again.
      run: [
        { kind: "click", target: { role: "button", name: "Connect wallet" }, note: 'Click "Connect wallet"', optional: true },
        { kind: "click", target: { role: "button", name: "MetaMask", withinDialog: true }, note: 'Click "MetaMask"', optional: true },
      ],
    },
    // What was typed is this run's value, written back by its name.
    { type: "action", by: "code", do: "Type {{amount}} into Amount.", run: [{ kind: "fill", target: { testId: "amount" }, value: "{{amount}}" }] },
    { type: "check", by: "code", claim: "The Amount field holds {{amount}}.", expect: { kind: "shows", text: "{{amount}}" } },
    drafted.steps[3],
  ]);

  // The test as repaired, with a model that can't be asked.
  vi.mocked(createLlm).mockReset();
  vi.mocked(createLlm).mockImplementation(() => {
    throw new Error("A run asked for a model.");
  });
  const out = await runSuite({ target, suite: Suite.parse({ tests: [test] }), artifactsDir });
  expect(out.tests[0]).toMatchObject({ outcome: "passed", repairable: false });
  expect(out.tests[0]!.steps.map((s) => [s.status, s.by])).toEqual([["pass", "code"], ["pass", "code"], ["pass", "code"], ["pass", "code"]]);
  expect(createLlm).not.toHaveBeenCalled();
}, 240_000);
