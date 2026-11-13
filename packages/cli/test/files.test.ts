import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TestResult } from "@dappdrill/core";
import { printResult } from "../src/commands/run.js";
import { buildTarget } from "../src/commands/target.js";
import { UsageError, loadTests, parseChain, parseHeaders, parseResponses, parseStorage, parseToken, suiteOf } from "../src/files.js";

describe("parseChain", () => {
  it("fills in the RPC of a known chain", () => {
    expect(parseChain("8453")).toMatchObject({ id: 8453, name: "Base", mode: "fork" });
    expect(parseChain("8453").rpcUrl).toMatch(/^https:/);
  });

  it("runs chains that can't be forked live", () => {
    expect(parseChain("129302")).toMatchObject({ id: 129302, mode: "live" });
  });

  it("keeps an explicit RPC, including one with '=' in it", () => {
    expect(parseChain("999=https://rpc.example/?key=abc").rpcUrl).toBe("https://rpc.example/?key=abc");
  });

  it("rejects bad ids and unknown chains without an RPC", () => {
    expect(() => parseChain("base")).toThrow(UsageError);
    expect(() => parseChain("999")).toThrow(/pass its RPC/);
  });
});

describe("parseToken", () => {
  it("reads chain, token and a whole-token amount", () => {
    expect(parseToken("1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48=5000.5")).toEqual({
      chainId: 1,
      address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      amount: "5000.5",
    });
  });

  it("rejects anything else", () => {
    expect(() => parseToken("1:usdc=5")).toThrow(UsageError);
    expect(() => parseToken("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48=5")).toThrow(/expected <chain id>/);
  });
});

describe("parseHeaders", () => {
  it("reads --header flags and $DAPPDRILL_HEADERS lines, flags winning", () => {
    expect(parseHeaders(["X-Vercel-Protection-Bypass: abc:def"], "x-dappdrill-token: one\nx-other: two\n")).toEqual({
      "x-dappdrill-token": "one",
      "x-other": "two",
      "x-vercel-protection-bypass": "abc:def",
    });
    expect(parseHeaders(["x-dappdrill-token: flag"], "x-dappdrill-token: env")).toEqual({ "x-dappdrill-token": "flag" });
    expect(parseHeaders([], undefined)).toEqual({});
  });

  it("rejects malformed headers without echoing the value", () => {
    expect(() => parseHeaders(["no colon here"], undefined)).toThrow(UsageError);
    expect(() => parseHeaders(["x-token:"], undefined)).toThrow(/expected "Name: value"/);
  });
});

describe("parseStorage", () => {
  it("splits on the first =", () => {
    expect(parseStorage(["forkEnabled=true", "forkRPCUrl=http://x/?a=b"])).toEqual({ forkEnabled: "true", forkRPCUrl: "http://x/?a=b" });
    expect(() => parseStorage(["=nokey"])).toThrow(UsageError);
  });
});

describe("parseResponses", () => {
  it("reads url, optional status and body", async () => {
    expect(await parseResponses(['https://app.gmx.io/config.json {"uiVersion": 2.0}', "https://api.x/*/flags 503 down"])).toEqual([
      { url: "https://app.gmx.io/config.json", status: 200, body: '{"uiVersion": 2.0}' },
      { url: "https://api.x/*/flags", status: 503, body: "down" },
    ]);
    await expect(parseResponses(["just-a-url"])).rejects.toThrow(UsageError);
  });
});

const withdraw = { id: "test_1", name: "Withdraw everything", goal: "Withdraw it all.", steps: [{ type: "action", by: "llm", do: "Click Withdraw" }] };

async function saved(value: unknown): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "dappdrill-")), "tests.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}

describe("loadTests", () => {
  it("reads a tests file, defaulting what can be left out", async () => {
    const tests = await loadTests(await saved({ url: "https://app.example", tests: [withdraw] }));
    expect(tests).toMatchObject({ chains: [], tokens: [], notes: [], signing: "allowed" });
    expect(tests.tests[0]).toMatchObject({ name: "Withdraw everything", startPath: "/", cleanup: [] });
  });

  it("gives the engine the suite without where the app is", async () => {
    const suite = suiteOf(await loadTests(await saved({ url: "https://app.example", chains: [{ id: 8453, name: "Base", rpcUrl: "https://rpc.example" }], tests: [withdraw] })));
    expect(Object.keys(suite).sort()).toEqual(["notes", "signing", "tests"]);
  });

  it("says where a bad file is wrong, and refuses duplicate ids", async () => {
    await expect(loadTests(await saved({ url: "https://app.example", tests: [{ id: "x" }] }))).rejects.toThrow(/tests\.0\.name/);
    await expect(loadTests(await saved({ url: "https://app.example", tests: [withdraw, withdraw] }))).rejects.toThrow(/share the id test_1/);
    await expect(loadTests("/nope/tests.json")).rejects.toThrow(/dappdrill make/);
  });
});

describe("buildTarget", () => {
  const flags = { chain: [], token: [], initScript: [], header: [], storage: [], respond: [], out: "out" };
  const usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const file = {
    chains: [{ id: 8453, name: "Base", rpcUrl: "https://rpc.example", mode: "fork" as const, forkBlock: "100", fromApp: true }],
    tokens: [{ chainId: 8453, address: usdc, amount: "1000" }],
  };

  it("runs on the file's chains at the blocks the tests were made at, unless --chain names others", async () => {
    expect((await buildTarget("https://app.example", flags, "run", file)).chains).toMatchObject([{ id: 8453, forkBlock: "100" }]);
    const asked = await buildTarget("https://app.example", { ...flags, chain: ["1"] }, "run", file);
    expect(asked.chains.map((c) => c.id)).toEqual([1]);
  });

  it("makes tests on fresh copies, keeping the file's chains ready", async () => {
    const target = await buildTarget("https://app.example", flags, "make", file);
    expect(target.chains).toEqual([]);
    expect(target.learnedChains).toMatchObject([{ id: 8453 }]);
    expect(target.learnedChains[0]?.forkBlock).toBeUndefined();
  });

  it("lets a --token replace what the file gives the wallet", async () => {
    const target = await buildTarget("https://app.example", { ...flags, token: [`8453:${usdc.toLowerCase()}=5`] }, "run", file);
    expect(target.tokens).toEqual([{ chainId: 8453, address: usdc.toLowerCase(), amount: "5" }]);
  });
});

const review = (verdict: "dangerous" | "check" | "consistent", title: string) => ({ verdict, title, summary: "It spends USDC." }) as never;
const result = (outcome: TestResult["outcome"], more: object = {}): TestResult => ({ ...TestResult.parse({ testId: "a", outcome, steps: [], durationMs: 3000, costUsd: 0 }), ...more });

describe("printResult", () => {
  const printed = (r: TestResult) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printResult("Deposit", r);
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    return lines;
  };

  it("shows dangerous and check reviews under a test that passed, not consistent ones", () => {
    const signingReviews = [review("dangerous", "Approve USDC"), review("check", "Sign in"), review("consistent", "Deposit")];
    expect(printed(result("passed", { signingReviews })).slice(1)).toEqual(["      Dangerous: Approve USDC. It spends USDC.", "      Check this: Sign in. It spends USDC."]);
  });

  it("says couldn't verify, with the reason", () => {
    expect(printed(result("unverified", { reason: "The RPC is down." }))).toEqual(["  ? Deposit  couldn't verify", "      The RPC is down."]);
    expect(printed(result("failed", { reason: "The balance didn't move." }))).toEqual(["  ✗ Deposit  3s", "      The balance didn't move."]);
  });
});
