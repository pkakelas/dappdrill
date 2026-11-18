import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestResult } from "@dappdrill/core";
import { printResult } from "../src/commands/run.js";
import { buildTarget } from "../src/commands/target.js";
import { UsageError, loadTests, parseAccount, parseChain, parseFund, parseHeaders, parseResponses, parseStorage, suiteOf } from "../src/files.js";

describe("parseChain", () => {
  it("fills in the RPC of a known chain", () => {
    expect(parseChain("8453")).toMatchObject({ id: 8453, name: "Base" });
    expect(parseChain("8453").rpcUrl).toMatch(/^https:/);
    expect(Object.keys(parseChain("129302")).sort()).toEqual(["id", "name", "rpcUrl"]);
  });

  it("keeps an explicit RPC, including one with '=' in it", () => {
    expect(parseChain("999=https://rpc.example/?key=abc").rpcUrl).toBe("https://rpc.example/?key=abc");
  });

  it("rejects bad ids and unknown chains without an RPC", () => {
    expect(() => parseChain("base")).toThrow(UsageError);
    expect(() => parseChain("999")).toThrow(/pass its RPC/);
  });
});

describe("parseFund", () => {
  const usdc = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  it("reads the chain's coin, or a token by its address", () => {
    expect(parseFund("84532:0.05")).toEqual({ chainId: 84532, amount: "0.05" });
    expect(parseFund(`84532:${usdc}:100`)).toEqual({ chainId: 84532, token: usdc, amount: "100" });
  });

  it("rejects anything else", () => {
    expect(() => parseFund("84532")).toThrow(/expected <chain id>/);
    expect(() => parseFund("84532:usdc:5")).toThrow(UsageError);
    expect(() => parseFund(`${usdc}:5`)).toThrow(UsageError);
  });
});

describe("parseAccount", () => {
  it("takes new or kept", () => {
    expect(parseAccount("kept")).toBe("kept");
    expect(() => parseAccount("live")).toThrow(/expected new or kept/);
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
    expect(parseStorage(["testMode=true", "apiUrl=http://x/?a=b"])).toEqual({ testMode: "true", apiUrl: "http://x/?a=b" });
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
    expect(tests).toMatchObject({ chains: [], account: "new", fund: [], notes: [], signing: "allowed" });
    expect(tests.tests[0]).toMatchObject({ name: "Withdraw everything", startPath: "/", cleanup: [] });
  });

  it("gives the engine the suite without where the app is or the account it runs on", async () => {
    const suite = suiteOf(await loadTests(await saved({ url: "https://app.example", chains: [{ id: 8453, name: "Base", rpcUrl: "https://rpc.example" }], account: "kept", fund: [{ chainId: 8453, amount: "0.1" }], tests: [withdraw] })));
    expect(Object.keys(suite).sort()).toEqual(["notes", "signing", "tests"]);
  });

  it("reads a file written before tests ran on the app's own chains, leaving out what it no longer keeps", async () => {
    const old = { url: "https://app.example", chains: [{ id: 8453, name: "Base", rpcUrl: "https://rpc.example", mode: "fork", forkBlock: "100", fromApp: true }], tokens: [{ chainId: 8453, address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", amount: "1000" }], tests: [withdraw] };
    const tests = await loadTests(await saved(old));
    expect(tests.chains).toEqual([{ id: 8453, name: "Base", rpcUrl: "https://rpc.example", fromApp: true }]);
    expect(tests).not.toHaveProperty("tokens");
    expect(tests.tests).toHaveLength(1);
  });

  it("says where a bad file is wrong, and refuses duplicate ids", async () => {
    await expect(loadTests(await saved({ url: "https://app.example", tests: [{ id: "x" }] }))).rejects.toThrow(/tests\.0\.name/);
    await expect(loadTests(await saved({ url: "https://app.example", tests: [withdraw, withdraw] }))).rejects.toThrow(/share the id test_1/);
    await expect(loadTests("/nope/tests.json")).rejects.toThrow(/dappdrill make/);
  });
});

describe("buildTarget", () => {
  const flags = { chain: [], fund: [], initScript: [], header: [], storage: [], respond: [], out: "out" };
  const key = `0x${"ab".repeat(32)}`;
  const file = { chains: [{ id: 8453, name: "Base", rpcUrl: "https://rpc.example", fromApp: true }], account: "new" as const, fund: [] };
  afterEach(() => vi.unstubAllEnvs());

  it("runs on the file's chains, unless --chain names others", async () => {
    expect((await buildTarget("https://app.example", flags, "tests", file)).chains).toMatchObject([{ id: 8453 }]);
    const asked = await buildTarget("https://app.example", { ...flags, chain: ["1"] }, "tests", file);
    expect(asked.chains.map((c) => c.id)).toEqual([1]);
  });

  it("makes tests by looking again, keeping the file's chains ready", async () => {
    const target = await buildTarget("https://app.example", flags, "look", file);
    expect(target.chains).toEqual([]);
    expect(target.learnedChains).toMatchObject([{ id: 8453 }]);
  });

  it("starts every test on a new account unless told otherwise, and needs no key for it", async () => {
    vi.stubEnv("DAPPDRILL_KEY", "");
    expect(await buildTarget("https://app.example", flags, "tests", file)).toMatchObject({ account: "new", fund: [] });
    expect((await buildTarget("https://app.example", flags, "tests")).fundedKey).toBeUndefined();
  });

  it("sends each new account what --fund says from the key, the flags winning over the file", async () => {
    const funded = { ...file, fund: [{ chainId: 8453, amount: "0.01" }] };
    expect((await buildTarget("https://app.example", { ...flags, key }, "tests", funded)).fund).toEqual([{ chainId: 8453, amount: "0.01" }]);
    const target = await buildTarget("https://app.example", { ...flags, key, fund: ["8453:0.05"] }, "tests", funded);
    expect(target).toMatchObject({ account: "new", fundedKey: key, fund: [{ chainId: 8453, amount: "0.05" }] });
    vi.stubEnv("DAPPDRILL_KEY", "");
    await expect(buildTarget("https://app.example", flags, "tests", funded)).rejects.toThrow(/sent funds from a key/);
  });

  it("keeps the account the file says, with the key from --key or $DAPPDRILL_KEY", async () => {
    vi.stubEnv("DAPPDRILL_KEY", "");
    await expect(buildTarget("https://app.example", flags, "tests", { ...file, account: "kept" })).rejects.toThrow(/needs its key/);
    vi.stubEnv("DAPPDRILL_KEY", key);
    expect(await buildTarget("https://app.example", flags, "tests", { ...file, account: "kept" })).toMatchObject({ account: "kept", fundedKey: key });
    expect((await buildTarget("https://app.example", { ...flags, account: "new" }, "tests", { ...file, account: "kept" })).account).toBe("new");
  });

  it("refuses a key that isn't one, without echoing it", async () => {
    await expect(buildTarget("https://app.example", { ...flags, key: "hunter2" }, "tests", file)).rejects.toThrow(/^Bad key: expected a private key of 64 hex characters\.$/);
    await expect(buildTarget("https://app.example", { ...flags, account: "live" }, "tests", file)).rejects.toThrow(UsageError);
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

  it("says a test needs repairing, and with which command", () => {
    expect(printed(result("unverified", { reason: "Line 2 isn't code yet.", repairable: true }))).toEqual(["  ? Deposit  couldn't verify", "      Line 2 isn't code yet.", "      Needs repairing: run dappdrill repair."]);
  });
});
