import { mkdtemp, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DrillTarget, WalletRequest, type DrillEvent } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { startChains } from "../../src/chain/controller.js";
import { createSession, type EngineSession } from "../../src/browser/session.js";
import { readBalance } from "../../src/chain/deal-erc20.js";
import { rpcCall } from "../../src/chain/rpc.js";
import { ACCOUNTS, CHAIN_ID, startFixture, type Fixture } from "./fixture.js";

let fx: Fixture;
let chains: ChainController;
let artifactsDir: string;
const events: DrillEvent[] = [];

beforeAll(async () => {
  fx = await startFixture();
  chains = await startChains([{ id: CHAIN_ID, rpcUrl: fx.rpcUrl, mode: "fork" }], {});
  artifactsDir = await mkdtemp(path.join(os.tmpdir(), "dappdrill-session-"));
}, 60_000);

afterAll(async () => {
  await chains?.close();
  await fx?.close();
});

function target(url: string): DrillTarget {
  return DrillTarget.parse({ url, chains: [{ id: CHAIN_ID, rpcUrl: fx.rpcUrl }], accounts: ACCOUNTS });
}

async function open(bugs: string[] = [], opts: Partial<Parameters<typeof createSession>[2]> = {}): Promise<EngineSession> {
  const url = fx.pageUrl(bugs);
  const session = await createSession(target(url), chains, { artifactsDir, sink: (e) => void events.push(e), video: false, ...opts });
  await session.page.goto(url);
  return session;
}

async function connect(session: EngineSession, walletName = "MetaMask"): Promise<void> {
  await session.page.getByRole("button", { name: "Connect wallet" }).click();
  await session.page.getByRole("dialog").getByRole("button", { name: walletName, exact: true }).click();
  await session.page.getByText(session.wallet.accounts.A).waitFor();
}

describe("session", () => {
  it("injects a MetaMask-like provider announced through EIP-6963", async () => {
    const session = await open();
    try {
      const probe = await session.page.evaluate(async () => {
        const eth = (window as any).ethereum;
        const announced: string[] = [];
        window.addEventListener("eip6963:announceProvider", (e: any) => announced.push(e.detail.info.rdns));
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        return {
          isMetaMask: eth.isMetaMask,
          unlocked: await eth._metamask.isUnlocked(),
          chainId: await eth.request({ method: "eth_chainId" }),
          accountsBefore: await eth.request({ method: "eth_accounts" }),
          netVersion: eth.networkVersion,
          announced,
          legacySend: eth.send({ method: "net_version", id: 1 }).result,
        };
      });
      expect(probe.isMetaMask).toBe(true);
      expect(probe.unlocked).toBe(true);
      expect(probe.chainId).toBe("0x7a69");
      expect(probe.accountsBefore).toEqual([]);
      expect(probe.netVersion).toBe("31337");
      expect(probe.announced).toEqual(["io.metamask"]);
      expect(probe.legacySend).toBe("31337");
    } finally {
      await session.close();
    }
  }, 60_000);

  it("routes the page's own JSON-RPC (single + batch) to the fork and logs it", async () => {
    const session = await open();
    try {
      await connect(session);
      // block number shown by the page comes from the fork, which is pinned at the real chain's tip
      const forkBlock = Number(chains.configs()[0]!.forkBlock);
      await expect.poll(() => session.page.locator("#block").textContent()).toBe(String(forkBlock));
      await expect.poll(() => session.page.locator("#balance").textContent()).toBe("1000.00");
      const pageRpc = session.rpc.filter((r) => r.via === "page");
      expect(pageRpc.map((r) => r.method)).toEqual(expect.arrayContaining(["eth_blockNumber", "eth_chainId", "eth_call"]));
      expect(pageRpc.every((r) => r.chainId === CHAIN_ID && r.url?.startsWith(fx.rpcUrl))).toBe(true);
      expect(session.wallet.requests().map((r) => r.kind)).toContain("connect");
      expect(session.lastClickedLabel()).toBe("MetaMask");
    } finally {
      await session.close();
    }
  }, 60_000);

  it("approve + deposit go through the wallet onto the fork only; errors look like MetaMask", async () => {
    const session = await open();
    try {
      await connect(session);
      await session.page.getByTestId("amount").fill("5");
      await session.page.getByRole("button", { name: "Deposit" }).click();

      const approve = await session.wallet.nextSign(15_000);
      expect(approve.request.method).toBe("eth_sendTransaction");
      expect(approve.buttonLabel).toBe("Deposit");
      expect((approve.request.params as any)[0].to.toLowerCase()).toBe(fx.token.toLowerCase());
      const approveHash = await session.wallet.approve(approve.request.id);
      expect(approveHash).toMatch(/^0x[0-9a-f]{64}$/);

      const deposit = await session.wallet.nextSign(15_000);
      expect((deposit.request.params as any)[0].to.toLowerCase()).toBe(fx.vault.toLowerCase());
      await session.wallet.approve(deposit.request.id);

      await session.page.getByText("Deposited 5 TUSD").waitFor({ timeout: 15_000 });
      await expect.poll(() => session.page.locator("#shares").textContent()).toBe("5.00");
      expect(session.wallet.requests().filter((r) => r.kind === "sign" && r.outcome === "approved")).toHaveLength(2);

      // the real chain never saw it
      const real = await readBalance((m, p) => rpcCall(fx.rpcUrl, m, p), fx.token, session.wallet.accounts.A);
      expect(real).toBe(1_000_000_000n);

      // second deposit: reject it
      await session.page.getByRole("button", { name: "Deposit" }).click();
      const second = await session.wallet.nextSign(15_000);
      await session.wallet.reject(second.request.id);
      await session.page.getByText("You rejected the transaction").waitFor({ timeout: 5_000 });
      expect(session.wallet.requests().at(-1)).toMatchObject({ outcome: "rejected", error: "4001 User rejected the request." });
      expect(await session.page.getByRole("button", { name: "Deposit" }).isEnabled()).toBe(true);

      const shot = await session.screenshot("after-reject");
      await expect(stat(path.join(artifactsDir, shot))).resolves.toBeTruthy();
    } finally {
      await session.close();
    }
  }, 90_000);

  it("signs messages and typed data with the selected account", async () => {
    const session = await open();
    try {
      await connect(session);
      await session.page.getByRole("button", { name: "Sign message" }).click();
      const msg = await session.wallet.nextSign(10_000);
      expect(msg.request.method).toBe("personal_sign");
      const sig = (await session.wallet.approve(msg.request.id)) as string;
      expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
      await session.page.getByText("Signed: ").waitFor();

      await session.page.getByRole("button", { name: "Sign typed data" }).click();
      const typed = await session.wallet.nextSign(10_000);
      expect(typed.request.method).toBe("eth_signTypedData_v4");
      await session.wallet.approve(typed.request.id);
      await session.page.getByText("Typed signature: ").waitFor();

      // account switch from the wallet side reaches the page
      await session.wallet.switchAccount("B");
      await session.page.getByText(session.wallet.accounts.B).waitFor();
    } finally {
      await session.close();
    }
  }, 60_000);

  it("answers unknown chains with 4902 and switches to chains we run", async () => {
    const session = await open([], { policy: { unknownChainOnce: true } });
    try {
      const res = await session.page.evaluate(async () => {
        const eth = (window as any).ethereum;
        const out: any = {};
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] });
        } catch (e: any) {
          out.first = { code: e.code, message: e.message };
        }
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
        } catch (e: any) {
          out.unknown = { code: e.code };
        }
        out.known = await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7a69" }] });
        try {
          await eth.request({ method: "eth_sendTransaction", params: [{ to: "0x0000000000000000000000000000000000000001" }] });
        } catch (e: any) {
          out.unauthorized = e.code;
        }
        return out;
      });
      expect(res.first).toEqual({ code: 4902, message: 'Unrecognized chain ID "0x7a69". Try adding the chain using wallet_addEthereumChain first.' });
      expect(res.unknown.code).toBe(4902);
      expect(res.known).toBeNull();
      expect(res.unauthorized).toBe(4100);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("on a chain we don't run, still signs messages but refuses typed data for another chain", async () => {
    const session = await open([], { startChainId: 1, policy: { autoSign: true } });
    try {
      const res = await session.page.evaluate(async () => {
        const eth = (window as any).ethereum;
        const [from] = await eth.request({ method: "eth_requestAccounts" });
        const typed = (chainId: number) =>
          JSON.stringify({
            types: { EIP712Domain: [{ name: "chainId", type: "uint256" }], Hello: [{ name: "a", type: "uint256" }] },
            domain: { chainId },
            primaryType: "Hello",
            message: { a: 1 },
          });
        const out: any = { message: await eth.request({ method: "personal_sign", params: ["0x68656c6c6f", from] }) };
        out.sameChain = await eth.request({ method: "eth_signTypedData_v4", params: [from, typed(1)] });
        try {
          await eth.request({ method: "eth_signTypedData_v4", params: [from, typed(31337)] });
        } catch (e: any) {
          out.otherChain = { code: e.code, message: e.message };
        }
        return out;
      });
      expect(res.message).toMatch(/^0x[0-9a-f]{130}$/);
      expect(res.sameChain).toMatch(/^0x[0-9a-f]{130}$/);
      expect(res.otherChain).toEqual({ code: -32602, message: 'Invalid parameters: Provided chainId "31337" must match the active chainId "1"' });
    } finally {
      await session.close();
    }
  }, 60_000);

  it("two wallets: both announced, and we record which one the dApp used", async () => {
    const session = await open(["wrongprovider"], { twoWallets: true });
    try {
      const names = await session.page.evaluate(() => {
        const found: string[] = [];
        window.addEventListener("eip6963:announceProvider", (e: any) => found.push(e.detail.info.name));
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        return { found, primaryIsRabby: (window as any).ethereum.isRabby, providers: (window as any).ethereum.providers.length };
      });
      // the second wallet (Rabby) took over window.ethereum, as real extensions do
      expect(names.found).toEqual(["Rabby Wallet", "MetaMask"]);
      expect(names.primaryIsRabby).toBe(true);
      expect(names.providers).toBe(2);
      // the buggy page always uses window.ethereum (Rabby) even when the user picks MetaMask
      await connect(session, "MetaMask");
      expect([...session.wallet.usedWallets]).toEqual(["rabby"]);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("two wallets: a passive read through window.ethereum doesn't count as using that wallet", async () => {
    const session = await open([], { twoWallets: true });
    try {
      await session.page.evaluate(() => (window as any).ethereum.request({ method: "eth_chainId" }));
      await connect(session, "MetaMask");
      expect([...session.wallet.usedWallets]).toEqual(["metamask"]);
      // A call without params still records as a valid request (reports are parsed on upload).
      for (const r of session.wallet.requests()) expect(WalletRequest.safeParse(r).success).toBe(true);
    } finally {
      await session.close();
    }
  }, 60_000);

  it("captures console/page errors, frames, and saves a trace + video on close", async () => {
    const session = await createSession(target(fx.pageUrl(["crash"])), chains, { artifactsDir, sink: (e) => void events.push(e), frameIntervalMs: 300 });
    await session.page.goto(fx.pageUrl(["crash"]));
    await session.page.waitForTimeout(1500);
    const out = await session.close();
    expect(session.console.some((c) => c.level === "pageerror" && c.text.includes("seeded uncaught error"))).toBe(true);
    expect(out.trace).toMatch(/^traces\/.*\.zip$/);
    expect(out.video).toMatch(/^videos\/.*\.webm$/);
    await expect(stat(path.join(artifactsDir, out.video!))).resolves.toBeTruthy();
    expect(events.some((e) => e.type === "frame")).toBe(true);
    expect(events.some((e) => e.type === "wallet-request")).toBe(true);
  }, 60_000);
});
