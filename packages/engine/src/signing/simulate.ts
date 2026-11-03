/**
 * Transaction simulation. On a fork: snapshot → impersonate the sender → send
 * → read the receipt → measure balances → revert. Balances for the sender are
 * read directly (before/after the snapshot) so wrapped-ETH deposits, rebasing
 * tokens and the like come out right; other parties come from Transfer logs.
 * On a live chain we can only eth_call for status / revert reason.
 */
import { decodeEventLog, getAddress, toHex, type Address, type Hex } from "viem";
import type { ApprovalGrant, BalanceChange } from "@dappdrill/core";
import type { ChainController } from "../types.js";
import { BUILTIN_ABI, TRANSFER_EVENTS_ABI } from "./builtin.js";
import type { Contracts, TokenInfo } from "./contract.js";
import { displayAmount, displayNative } from "./format.js";
import { withTimeout } from "./http.js";
import type { Call } from "./request.js";

export interface AllowanceChange {
  token: string;
  symbol?: string;
  spender: string;
  before: string;
  after: string;
}

export interface Simulation {
  status: "ok" | "reverted" | "unavailable";
  balanceChanges: BalanceChange[];
  allowanceChanges: AllowanceChange[];
  revertReason?: string;
  gasUsed?: string;
}

interface Receipt {
  status: Hex;
  gasUsed: Hex;
  effectiveGasPrice?: Hex;
  logs: { address: Address; topics: Hex[]; data: Hex }[];
}

export interface SimulateInput {
  chains: ChainController;
  chainId: number;
  from: Address;
  calls: Call[];
  contracts: Contracts;
  approvals: ApprovalGrant[];
  nativeSymbol: string;
  timeoutMs?: number;
}

const GAS_ALLOWANCE = 10n ** 18n;

export async function simulate(input: SimulateInput): Promise<Simulation> {
  const unavailable = (why: string): Simulation => ({ status: "unavailable", balanceChanges: [], allowanceChanges: [], revertReason: why });
  if (!input.chains.has(input.chainId)) return unavailable(`Chain ${input.chainId} is not available in this session`);
  try {
    const run = input.chains.mode(input.chainId) === "fork" ? onFork(input) : onLive(input);
    return await withTimeout(run, input.timeoutMs ?? 30_000, unavailable("Simulation timed out"));
  } catch (e) {
    return unavailable(`Simulation failed: ${(e as Error).message}`);
  }
}

async function onLive({ chains, chainId, from, calls }: SimulateInput): Promise<Simulation> {
  const client = chains.client(chainId);
  for (const call of calls) {
    try {
      await client.call({ account: from, to: call.to, data: call.data, value: call.value });
    } catch (e) {
      return { status: "reverted", balanceChanges: [], allowanceChanges: [], revertReason: revertReason(e) };
    }
  }
  return { status: "ok", balanceChanges: [], allowanceChanges: [], revertReason: "Live chain: balance changes aren't measured" };
}

async function onFork(input: SimulateInput): Promise<Simulation> {
  const { chains, chainId, from, calls, contracts } = input;
  const client = chains.client(chainId);
  const rpc = (method: string, params: unknown[]) => chains.request(chainId, method, params);
  const snapshot = await chains.snapshot(chainId);
  try {
    await chains.impersonate(chainId, from);
    // The review is about what the call does, not whether the wallet can pay for gas
    // (the low-gas edge case drains it on purpose). A value above the real balance still reverts.
    const balance = await client.getBalance({ address: from });
    await chains.setBalance(chainId, from, balance + GAS_ALLOWANCE);
    const receipts: Receipt[] = [];
    let gasCost = 0n;
    for (const call of calls) {
      let hash: Hex;
      try {
        hash = (await rpc("eth_sendTransaction", [{ from, to: call.to, data: call.data, value: toHex(call.value) }])) as Hex;
      } catch (e) {
        return { status: "reverted", balanceChanges: [], allowanceChanges: [], revertReason: revertReason(e) };
      }
      const receipt = await waitForReceipt(chains, chainId, hash);
      if (!receipt) return { status: "unavailable", balanceChanges: [], allowanceChanges: [], revertReason: "The transaction was not mined on the fork" };
      gasCost += BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice ?? "0x0");
      if (receipt.status !== "0x1") {
        let reason = "execution reverted";
        try {
          await client.call({ account: from, to: call.to, data: call.data, value: call.value });
        } catch (e) {
          reason = revertReason(e);
        }
        return { status: "reverted", balanceChanges: [], allowanceChanges: [], revertReason: reason, gasUsed: BigInt(receipt.gasUsed).toString() };
      }
      receipts.push(receipt);
    }

    // Tokens to measure for the sender: everything that logged, plus approval targets and ERC-20 call targets.
    const candidates = new Set<string>();
    for (const r of receipts) for (const log of r.logs) candidates.add(log.address.toLowerCase());
    for (const a of input.approvals) candidates.add(a.token.toLowerCase());
    for (const c of calls) if (c.to) candidates.add(c.to.toLowerCase());
    const tokens: TokenInfo[] = [];
    for (const t of await Promise.all([...candidates].slice(0, 25).map((a) => contracts.token(getAddress(a))))) {
      if (t?.standard === "erc20") tokens.push(t);
    }
    const erc20Approvals = input.approvals.filter((a) => a.standard === "erc20" || a.standard === "permit");

    const after = await readState(client, from, tokens, erc20Approvals);
    await chains.revert(chainId, snapshot);
    const before = await readState(client, from, tokens, erc20Approvals);

    const changes: BalanceChange[] = [];
    const nativeDelta = after.native - before.native - GAS_ALLOWANCE + gasCost;
    if (nativeDelta !== 0n) changes.push({ owner: from, token: "native", symbol: input.nativeSymbol, decimals: 18, delta: nativeDelta.toString(), display: signed(nativeDelta, displayNative(abs(nativeDelta), input.nativeSymbol)) });
    for (const t of tokens) {
      const delta = (after.balances.get(t.address) ?? 0n) - (before.balances.get(t.address) ?? 0n);
      if (delta !== 0n) changes.push({ owner: from, token: t.address, symbol: t.symbol, decimals: t.decimals, delta: delta.toString(), display: signed(delta, displayAmount(abs(delta), t)) });
    }
    changes.push(...(await otherParties(receipts, from, contracts)));

    const allowanceChanges: AllowanceChange[] = erc20Approvals.map((a) => {
      const token = tokens.find((t) => t.address.toLowerCase() === a.token.toLowerCase());
      const show = (v: bigint | undefined) => (v === undefined ? "unknown" : displayAmount(v, token, { totalSupply: token?.totalSupply }));
      return { token: a.token, symbol: a.symbol, spender: a.spender, before: show(before.allowances.get(allowanceKey(a))), after: show(after.allowances.get(allowanceKey(a))) };
    });
    const gasUsed = receipts.reduce((sum, r) => sum + BigInt(r.gasUsed), 0n).toString();
    return { status: "ok", balanceChanges: changes, allowanceChanges, gasUsed };
  } finally {
    // Revert again: harmless if we already did, essential if we bailed out early.
    await chains.revert(chainId, snapshot).catch(() => undefined);
  }
}

async function waitForReceipt(chains: ChainController, chainId: number, hash: Hex): Promise<Receipt | undefined> {
  for (let i = 0; i < 10; i++) {
    const receipt = (await chains.request(chainId, "eth_getTransactionReceipt", [hash])) as Receipt | null;
    if (receipt) return receipt;
    if (i === 1) await chains.mine(chainId).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 150));
  }
  return undefined;
}

async function readState(client: ReturnType<ChainController["client"]>, from: Address, tokens: TokenInfo[], approvals: ApprovalGrant[]) {
  const native = await client.getBalance({ address: from });
  const balances = new Map<Address, bigint>();
  const allowances = new Map<string, bigint>();
  await Promise.all([
    ...tokens.map(async (t) => {
      try {
        balances.set(t.address, (await client.readContract({ address: t.address, abi: BUILTIN_ABI, functionName: "balanceOf", args: [from] })) as bigint);
      } catch {
        // Not readable: leave it out.
      }
    }),
    ...approvals.map(async (a) => {
      try {
        allowances.set(allowanceKey(a), (await client.readContract({ address: a.token as Address, abi: BUILTIN_ABI, functionName: "allowance", args: [from, a.spender] })) as bigint);
      } catch {
        // Not an ERC-20 after all.
      }
    }),
  ]);
  return { native, balances, allowances };
}

/** Transfer-log deltas for everyone except the sender (whose balances are read directly). */
async function otherParties(receipts: Receipt[], sender: Address, contracts: Contracts): Promise<BalanceChange[]> {
  const deltas = new Map<string, { owner: Address; token: Address; id?: bigint; delta: bigint }>();
  const add = (owner: Address, token: Address, delta: bigint, id?: bigint) => {
    if (owner.toLowerCase() === sender.toLowerCase()) return;
    const key = `${owner}|${token}|${id ?? ""}`.toLowerCase();
    const cur = deltas.get(key);
    if (cur) cur.delta += delta;
    else deltas.set(key, { owner, token, id, delta });
  };
  for (const r of receipts) {
    for (const log of r.logs) {
      let ev;
      try {
        ev = decodeEventLog({ abi: TRANSFER_EVENTS_ABI, topics: log.topics as [Hex, ...Hex[]], data: log.data, strict: false });
      } catch {
        continue;
      }
      const a = ev.args as Record<string, unknown>;
      if (ev.eventName === "Transfer" && typeof a.from === "string" && typeof a.to === "string") {
        const isNft = log.topics.length === 4;
        const amount = isNft ? 1n : ((a.value as bigint | undefined) ?? 0n);
        const id = isNft ? (a.tokenId as bigint | undefined) : undefined;
        add(a.from as Address, log.address, -amount, id);
        add(a.to as Address, log.address, amount, id);
      } else if (ev.eventName === "TransferSingle" && typeof a.from === "string" && typeof a.to === "string") {
        add(a.from as Address, log.address, -((a.value as bigint | undefined) ?? 0n), a.id as bigint);
        add(a.to as Address, log.address, (a.value as bigint | undefined) ?? 0n, a.id as bigint);
      }
    }
  }
  const out: BalanceChange[] = [];
  for (const d of [...deltas.values()].filter((d) => d.delta !== 0n).slice(0, 20)) {
    const t = await contracts.token(d.token);
    const display = d.id !== undefined && t?.standard !== "erc20" ? signed(d.delta, `${t?.symbol ?? "token"} #${d.id}`) : signed(d.delta, displayAmount(abs(d.delta), t));
    out.push({ owner: d.owner, token: d.token, symbol: t?.symbol, decimals: t?.decimals, delta: d.delta.toString(), display });
  }
  return out;
}

function allowanceKey(a: ApprovalGrant): string {
  return `${a.token}|${a.spender}`.toLowerCase();
}

function revertReason(e: unknown): string {
  const err = e as { shortMessage?: string; details?: string; message?: string; data?: { message?: string } };
  const text = err.details ?? err.data?.message ?? err.shortMessage ?? err.message ?? String(e);
  return text.replace(/\s+/g, " ").slice(0, 200);
}

const abs = (v: bigint) => (v < 0n ? -v : v);
const signed = (v: bigint, text: string) => (v < 0n ? `−${text}` : `+${text}`);
