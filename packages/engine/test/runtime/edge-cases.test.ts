import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget, CONDITIONS, chainName, type DrillEvent, type EdgeCaseId, type ReplayScript, type Issue } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { runEdgeCases, type RunEdgeCasesResult } from "../../src/replay/edge-cases.js";
import { privateKeyToAccount } from "viem/accounts";
import { VAULT_ABI } from "./contracts.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "./fixture.js";
import { depositScript } from "./script.js";

const OTHER_CHAIN = 31338;

let fx: Fixture;
let chains: ChainController;
let artifactsDir: string;

beforeAll(async () => {
  fx = await startFixture();
  // Two forks of the same anvil: the test's chain and a "wrong" one for the network edge cases.
  chains = await startChains(
    [
      { id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" },
      { id: OTHER_CHAIN, rpcUrl: fx.rpcUrl, mode: "fork" },
    ],
    {},
  );
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-edge-"));
}, 90_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

async function matrix(bugs: string[], edgeCases: EdgeCaseId[], script?: (url: string) => ReplayScript): Promise<RunEdgeCasesResult & { events: DrillEvent[] }> {
  const url = fx.pageUrl(bugs);
  const target = DrillTarget.parse({ url, chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }, { id: OTHER_CHAIN, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS });
  const events: DrillEvent[] = [];
  const result = await runEdgeCases({
    target,
    chains,
    script: script?.(url) ?? depositScript(url, fx.token, fx.vault),
    edgeCases,
    sink: async (e) => void events.push(e),
    artifactsDir,
    video: false,
    log: (m) => console.log(`  [${bugs.join(",") || "good"}] ${m}`),
  });
  for (const r of result.runs) console.log(`  [${bugs.join(",") || "good"}] ${r.edgeCase.padEnd(18)} ${r.status}${r.reason ? `  (${r.reason})` : ""}`);
  return { ...result, events };
}

const titles = (issues: Issue[]) => issues.map((i) => `${i.severity}: ${i.title}`);

describe("runEdgeCases", () => {
  it("passes every edge case on the well-behaved dApp", async () => {
    const r = await matrix([], CONDITIONS.map((e) => e.id));
    expect(titles(r.issues)).toEqual([]);
    expect(r.runs).toHaveLength(CONDITIONS.length);
    expect(r.runs.map((x) => x.status)).toEqual(r.runs.map(() => "pass"));
    expect(r.runs.every((x) => x.forkBlocks[String(CHAIN_ID)] !== undefined && x.mode === "fork")).toBe(true);
    // artifacts and events
    const happy = r.runs.find((x) => x.edgeCase === "happy")!;
    expect(happy.finalScreenshot).toMatch(/\.png$/);
    expect(happy.trace).toMatch(/\.zip$/);
    expect(happy.walletRequests.filter((w) => w.kind === "sign")).toHaveLength(2);
    expect(happy.rpc.length).toBeGreaterThan(0);
    const statuses = r.events.filter((e) => e.type === "test-status").map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(["running", "tested"]);
    expect(r.events.filter((e) => e.type === "run")).toHaveLength(CONDITIONS.length);
    // every case ran on pristine state: the vault only holds what the last run left, and that was reverted
    const shares = await chains.client(CHAIN_ID).readContract({ address: fx.vault, abi: VAULT_ABI, functionName: "shares", args: [privateKeyToAccount(ACCOUNTS.A).address] });
    expect(shares).toBe(0n);
  }, 600_000);

  it("finds the seeded recovery bugs: stuck button and silent rejection", async () => {
    const stuck = await matrix(["stuck"], ["reject"]);
    expect(titles(stuck.issues)).toEqual(["high: Rejecting 'Deposit' leaves the button stuck on 'Confirming…'"]);
    expect(stuck.runs[0]!.status).toBe("issue");
    const issue = stuck.issues[0]!;
    expect(issue.stepsToReproduce[0]).toBe("Reject the test's main request in the wallet (error 4001).");
    expect(issue.stepsToReproduce).toContain('4. Click "Deposit"');
    expect(issue.evidence?.walletAsked).toMatch(/^approve\(/);
    expect(issue.evidence?.screenshot).toMatch(/\.png$/);
    expect(issue.fingerprint).toBe(stuck.issues[0]!.fingerprint);
    expect(stuck.events.some((e) => e.type === "issue")).toBe(true);

    const silent = await matrix(["silent"], ["reject"]);
    expect(titles(silent.issues)).toEqual(["medium: No message after rejecting 'Deposit'"]);
  }, 180_000);

  it("doesn't blame the rejection when the test broke before anything was rejected", async () => {
    const broken = (url: string) => {
      const script = depositScript(url, fx.token, fx.vault);
      return { ...script, steps: script.steps.map((s, i) => (i === 3 ? { kind: "click" as const, target: { role: "button", name: "Stake" } } : s)) };
    };
    const r = await matrix(["silent"], ["reject"], broken);
    expect(r.runs[0]!.status).toBe("fail");
    expect(titles(r.issues)).toEqual([]);
  }, 180_000);

  it("finds a transaction sent from the old account after an account switch", async () => {
    const r = await matrix(["stale"], ["switch-account"]);
    expect(titles(r.issues)).toEqual(["critical: After switching accounts, the approve transaction still comes from the old account"]);
    // the bad request was rejected, never signed
    expect(r.runs[0]!.walletRequests.filter((w) => w.kind === "sign").map((w) => w.outcome)).toEqual(["rejected"]);
  }, 180_000);

  it("finds transactions sent on the wrong network and a dApp that can't add the chain", async () => {
    const noswitch = await matrix(["noswitch"], ["wrong-network"]);
    expect(titles(noswitch.issues)).toEqual([`critical: Sends the approve transaction on ${chainName(OTHER_CHAIN)} instead of ${chainName(CHAIN_ID)}`]);
    expect(noswitch.runs[0]!.walletRequests.filter((w) => w.kind === "sign").map((w) => w.outcome)).toEqual(["rejected"]);

    const noadd = await matrix(["noadd"], ["unknown-chain"]);
    expect(titles(noadd.issues)).toEqual([`critical: Sends the approve transaction on ${chainName(OTHER_CHAIN)} instead of ${chainName(CHAIN_ID)}`]);
    const switchReq = noadd.runs[0]!.walletRequests.find((w) => w.method === "wallet_switchEthereumChain");
    expect(switchReq?.error).toMatch(/^4902 Unrecognized chain ID/);
  }, 240_000);

  it("finds a dApp that talks to the wrong wallet when two are installed", async () => {
    const r = await matrix(["wrongprovider"], ["two-wallets"]);
    expect(titles(r.issues)).toEqual(["high: With two wallets installed, the dApp talks to Rabby instead of MetaMask"]);
    expect(r.issues[0]?.actual).toMatch(/^Rabby got eth_requestAccounts/);
  }, 180_000);

  it("finds needless approvals, lost pending transactions and ignored speed-ups", async () => {
    const always = await matrix(["alwaysapprove"], ["happy", "existing-approval"]);
    expect(titles(always.issues)).toEqual(["medium: Asks for a token approval that was already granted"]);

    const reload = await matrix(["reloadloss"], ["happy", "reload-while-pending"]);
    expect(titles(reload.issues)).toEqual(["medium: Reloading while a transaction is pending loses track of it"]);

    const noreplace = await matrix(["noreplace"], ["happy", "speed-up"]);
    expect(titles(noreplace.issues)).toEqual(["medium: Doesn't notice when a pending transaction is sped up"]);
  }, 400_000);

  it("finds double submissions and uncaught page errors on the happy path", async () => {
    const dbl = await matrix(["double"], ["happy"]);
    expect(titles(dbl.issues)).toEqual(["high: Clicking 'Deposit' sends two signing requests"]);
    expect(dbl.runs[0]!.status).toBe("issue");

    const crash = await matrix(["crash"], ["happy"]);
    expect(titles(crash.issues)).toEqual(["medium: Uncaught error on the page during the test"]);
    expect(crash.issues[0]!.actual).toMatch(/seeded uncaught error/);
  }, 180_000);

  it("skips cases that don't apply and says why", async () => {
    const r = await matrix([], ["existing-approval", "speed-up"]);
    // cases run in the matrix's own order, whatever order they were asked in
    expect(r.runs.map((x) => [x.edgeCase, x.status, x.reason])).toEqual([
      ["speed-up", "pass", undefined],
      ["existing-approval", "skipped", "needs the happy path first to learn the test's approval"],
    ]);

    // A transaction the test rejects is never sent: no gas to run out of, nothing to speed up.
    const rejecting = (url: string) => {
      const f = depositScript(url, fx.token, fx.vault);
      return { ...f, id: "test_reject", steps: [...f.steps.slice(0, 4), { kind: "wallet" as const, respond: "reject" as const }] };
    };
    const rr = await matrix([], ["happy", "speed-up", "low-gas"], rejecting);
    expect(rr.runs.map((x) => [x.edgeCase, x.status, x.reason])).toEqual([
      ["happy", "pass", undefined],
      ["low-gas", "skipped", "the test sends no transaction"],
      ["speed-up", "skipped", "the test sends no transaction"],
    ]);
  }, 180_000);
});
