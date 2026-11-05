import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TestRunResult } from "@dappdrill/core";
import type { TestOutcome } from "@dappdrill/engine";
import { addUnhappyPaths, printOutcome } from "../src/commands/run.js";
import { UsageError, loadTests, parseChain, parseHeaders, parseResponses, parseStorage, parseToken, pickConditions, type TestsFile } from "../src/files.js";
import { renderJunit } from "../src/junit.js";
import { renderMarkdown } from "../src/markdown.js";
import { reviewsLine, withStopped } from "../src/outcomes.js";

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
    const tests = await loadTests(await saved({ url: "https://app.example", tests: [withdraw] }));
    expect(tests.chains).toEqual([]);
    expect(tests.tests[0]?.name).toBe("Withdraw everything");
  });

  it("says where a bad file is wrong, and refuses duplicate ids", async () => {
    await expect(loadTests(await saved({ url: "https://app.example", tests: [{ id: "x" }] }))).rejects.toThrow(/tests\.0\.name/);
    await expect(loadTests(await saved({ url: "https://app.example", tests: [withdraw, withdraw] }))).rejects.toThrow(/share the id test_1/);
    await expect(loadTests("/nope/tests.json")).rejects.toThrow(/dappdrill analyze/);
  });
});

const signs = { ...withdraw, steps: [{ text: "Approve in the wallet", actions: [{ kind: "wallet", respond: "approve" } as never] }] };
const usual = pickConditions({ unhappy: true, condition: [] });

describe("addUnhappyPaths", () => {
  it("adds the conditions after each happy path that signs, once", () => {
    const tests: TestsFile = { url: "https://app.example", chains: [], tests: [signs] };
    expect(addUnhappyPaths(tests, usual)).toHaveLength(4);
    const after = tests.tests;
    expect(after[0]).toBe(signs);
    expect(after.slice(1).map((t) => [t.condition, t.baseId, t.steps.length])).toEqual([
      ["reject", "test_1", 0],
      ["slow-rpc", "test_1", 0],
      ["wrong-network", "test_1", 0],
      ["low-gas", "test_1", 0],
    ]);
    expect(addUnhappyPaths(tests, usual)).toEqual([]);
    expect(tests.tests).toHaveLength(5);
  });

  it("leaves tests alone until a run has seen them sign", () => {
    const neverRan = withdraw;
    const noWallet = { ...withdraw, id: "test_2", steps: [{ text: "Read the balance", actions: [] }] };
    const tests: TestsFile = { url: "https://app.example", chains: [], tests: [neverRan, noWallet] };
    expect(addUnhappyPaths(tests, usual)).toEqual([]);
  });
});

describe("pickConditions", () => {
  it("is the usual ones, plus any named, without repeats", () => {
    expect(usual).toEqual(["reject", "slow-rpc", "wrong-network", "low-gas"]);
    expect(pickConditions({ condition: ["failing-rpc"] })).toEqual(["failing-rpc"]);
    expect(pickConditions({ unhappy: true, condition: ["reject", "failing-rpc"] })).toEqual([...usual, "failing-rpc"]);
    expect(pickConditions({ condition: [] })).toEqual([]);
  });

  it("names the choices on a typo", () => {
    expect(() => pickConditions({ condition: ["rejct"] })).toThrow(/Pick from: reject, /);
    expect(() => pickConditions({ condition: ["happy"] })).toThrow(UsageError);
  });
});

const outcome = (testId: string, status: TestOutcome["status"], result: object = {}): TestOutcome => ({ testId, status, result: TestRunResult.parse(result) });

const review = (verdict: "dangerous" | "check" | "consistent", title: string) => ({ verdict, title, summary: "It spends USDC." }) as never;

describe("reviewsLine", () => {
  it("counts what needs a look and never says safe", () => {
    expect(reviewsLine([])).toBeUndefined();
    expect(reviewsLine([review("consistent", "Deposit")])).toBe("1 signing request reviewed, all look consistent.");
    expect(reviewsLine([review("dangerous", "A"), review("check", "B"), review("consistent", "C")])).toBe("3 signing requests reviewed: 1 dangerous, 1 to check.");
  });
});

describe("printOutcome", () => {
  const printed = (o: TestOutcome) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    printOutcome("Deposit", 3, o);
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    return lines;
  };

  it("shows dangerous and check reviews under a test that passed, not consistent ones", () => {
    const signingReviews = [review("dangerous", "Approve USDC"), review("check", "Sign in"), review("consistent", "Deposit")];
    const lines = printed({ testId: "a", status: "pass", result: { ...TestRunResult.parse({}), signingReviews } });
    expect(lines.slice(1)).toEqual(["      Dangerous: Approve USDC. It spends USDC.", "      Check this: Sign in. It spends USDC."]);
  });

  it("says couldn't run and not run, with the reason", () => {
    expect(printed(outcome("a", "error", { failure: "The RPC is down." }))).toEqual(["  ! Deposit  couldn't run", "      The RPC is down."]);
    expect(printed(outcome("a", "skipped", { failure: "Needs a fork." }))).toEqual(["  - Deposit  not run", "      Needs a fork."]);
  });
});

describe("renderMarkdown", () => {
  const tests: TestsFile = { url: "https://app.example", chains: [], tests: [withdraw] };

  it("doesn't call an empty run a pass", () => {
    expect(renderMarkdown(tests, withStopped(["test_1"], []))).toContain("**No tests ran** on https://app.example");
    const skipped = renderMarkdown(tests, [outcome("test_1", "skipped", { failure: "Needs a fork." })]);
    expect(skipped).toContain("**No tests ran**");
    expect(skipped).toContain("Not run. Needs a fork.");
  });

  it("lists signing requests to check once, and counts them all", () => {
    const signingReviews = [review("check", "Sign in"), review("dangerous", "Approve USDC"), review("consistent", "Deposit"), review("check", "Sign in")];
    const md = renderMarkdown(tests, [{ testId: "test_1", status: "pass", result: { ...TestRunResult.parse({}), signingReviews } }]);
    expect(md).toContain("3 signing requests reviewed: 1 dangerous, 1 to check.");
    expect(md).toContain("Dangerous signature: Approve USDC");
    expect(md.match(/Check this: Sign in/g)).toHaveLength(1);
    expect(md).not.toContain("Deposit.");
  });
});

describe("renderJunit", () => {
  it("writes one suite for the app and escapes the failure", () => {
    const tests: TestsFile = { url: "https://app.example", chains: [], tests: [withdraw] };
    const xml = renderJunit(tests, [{ testId: "test_1", status: "fail", result: TestRunResult.parse({ failure: 'Step 1, "Click Withdraw": <disabled>' }) }]);
    expect(xml).toContain('<testsuite name="app.example" tests="1" failures="1"');
    expect(xml).toContain('<failure message="Step 1, &quot;Click Withdraw&quot;: &lt;disabled&gt;"/>');
  });

  it("gives the reason a test was skipped, and the signing requests a test made", () => {
    const tests: TestsFile = { url: "https://app.example", chains: [], tests: [withdraw] };
    expect(renderJunit(tests, [outcome("test_1", "skipped", { failure: "Needs a fork." })])).toContain('<skipped message="Needs a fork."/>');
    const xml = renderJunit(tests, [{ testId: "test_1", status: "pass", result: { ...TestRunResult.parse({}), signingReviews: [review("dangerous", "Approve <all> USDC")] } }]);
    expect(xml).toContain("<system-out>Dangerous: Approve &lt;all&gt; USDC. It spends USDC.</system-out>");
  });
});
