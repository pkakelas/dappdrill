import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TestRunResult } from "@dappdrill/core";
import { addUnhappyPaths } from "../src/commands/run.js";
import { UsageError, loadTests, parseChain, parseHeaders, parseResponses, parseStorage, parseToken, type TestsFile } from "../src/files.js";
import { renderJunit } from "../src/junit.js";

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

const withdraw = { id: "test_1", name: "Withdraw everything", goal: "Withdraw it all.", expected: "Balance is 0.", startPath: "/", steps: [{ text: "Click Withdraw" }] };

async function saved(value: unknown): Promise<string> {
  const path = join(await mkdtemp(join(tmpdir(), "dappdrill-")), "tests.json");
  await writeFile(path, JSON.stringify(value));
  return path;
}

describe("loadTests", () => {
  it("reads a tests file, defaulting what can be left out", async () => {
    const tests = await loadTests(await saved({ url: "https://app.example", flows: [{ name: "Withdraw", tests: [withdraw] }] }));
    expect(tests.chains).toEqual([]);
    expect(tests.flows[0]?.tests[0]?.name).toBe("Withdraw everything");
  });

  it("says where a bad file is wrong, and refuses duplicate ids", async () => {
    await expect(loadTests(await saved({ url: "https://app.example", flows: [{ name: "Withdraw", tests: [{ id: "x" }] }] }))).rejects.toThrow(/flows\.0\.tests\.0\.name/);
    await expect(loadTests(await saved({ url: "https://app.example", flows: [{ name: "W", tests: [withdraw, withdraw] }] }))).rejects.toThrow(/share the id test_1/);
    await expect(loadTests("/nope/tests.json")).rejects.toThrow(/dappdrill analyze/);
  });
});

describe("addUnhappyPaths", () => {
  it("adds the default conditions after each happy path, once", () => {
    const tests: TestsFile = { url: "https://app.example", chains: [], flows: [{ name: "Withdraw", tests: [withdraw] }] };
    addUnhappyPaths(tests);
    const after = tests.flows[0]!.tests;
    expect(after[0]).toBe(withdraw);
    expect(after.slice(1).map((t) => [t.condition, t.baseId, t.steps.length])).toEqual([
      ["reject", "test_1", 0],
      ["slow-rpc", "test_1", 0],
      ["wrong-network", "test_1", 0],
      ["low-gas", "test_1", 0],
    ]);
    addUnhappyPaths(tests);
    expect(tests.flows[0]!.tests).toHaveLength(5);
  });
});

describe("renderJunit", () => {
  it("writes a suite per flow and escapes the failure", () => {
    const tests: TestsFile = { url: "https://app.example", chains: [], flows: [{ name: "Withdraw", tests: [withdraw] }] };
    const xml = renderJunit(tests, [{ testId: "test_1", status: "fail", result: TestRunResult.parse({ failure: 'Step 1, "Click Withdraw": <disabled>' }) }]);
    expect(xml).toContain('<testsuite name="Withdraw" tests="1" failures="1"');
    expect(xml).toContain('<failure message="Step 1, &quot;Click Withdraw&quot;: &lt;disabled&gt;"/>');
  });
});
