/**
 * In-memory ChainController for unit tests: a handful of fake contracts with
 * code, storage, creation blocks and canned eth_call answers, behind a real
 * viem client. Runs in "live" mode, so the reviewer only eth_calls it.
 */
import { createPublicClient, custom, encodeFunctionResult, decodeFunctionData, toHex, type Address, type Hex, type PublicClient } from "viem";
import type { ChainConfig } from "@dappdrill/core";
import type { ChainController } from "../../src/types.js";
import { BUILTIN_ABI } from "../../src/signing/builtin.js";

export interface FakeContract {
  code?: Hex;
  /** Block the contract appeared in. Default 1. */
  createdAt?: bigint;
  storage?: Record<string, Hex>;
  /** Answer an eth_call; undefined → "0x". */
  call?: (data: Hex) => Hex | undefined;
}

export function fakeErc20(opts: { symbol: string; name?: string; decimals: number; totalSupply?: bigint; balances?: Record<string, bigint>; createdAt?: bigint }): FakeContract {
  const balances = new Map(Object.entries(opts.balances ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    createdAt: opts.createdAt,
    call: (data) => {
      const { functionName, args } = decodeFunctionData({ abi: BUILTIN_ABI, data });
      const result = (value: unknown) => encodeFunctionResult({ abi: BUILTIN_ABI, functionName, result: value as never });
      switch (functionName) {
        case "decimals": return result(opts.decimals);
        case "symbol": return result(opts.symbol);
        case "name": return result(opts.name ?? opts.symbol);
        case "totalSupply": return result(opts.totalSupply ?? 1_000_000n * 10n ** BigInt(opts.decimals));
        case "balanceOf": return result(balances.get(String(args![0]).toLowerCase()) ?? 0n);
        case "allowance": return result(0n);
        default: return undefined;
      }
    },
  };
}

export function fakeErc721(opts: { symbol: string; createdAt?: bigint }): FakeContract {
  return {
    createdAt: opts.createdAt,
    call: (data) => {
      const { functionName, args } = decodeFunctionData({ abi: BUILTIN_ABI, data });
      if (functionName === "supportsInterface") return encodeFunctionResult({ abi: BUILTIN_ABI, functionName, result: args![0] === "0x80ac58cd" });
      if (functionName === "symbol") return encodeFunctionResult({ abi: BUILTIN_ABI, functionName, result: opts.symbol });
      return undefined;
    },
  };
}

const BLOCK_SECONDS = 12n;

export class FakeChain implements ChainController {
  private readonly contracts = new Map<string, FakeContract>();
  readonly head: bigint;
  readonly genesisTimestamp: bigint;
  readonly log: { method: string; params: unknown[] }[] = [];
  private readonly viem: PublicClient;

  constructor(readonly chainId: number, contracts: Record<string, FakeContract>, opts: { head?: bigint; now?: bigint } = {}) {
    for (const [a, c] of Object.entries(contracts)) this.contracts.set(a.toLowerCase(), c);
    this.head = opts.head ?? 1_000_000n;
    const now = opts.now ?? BigInt(Math.floor(Date.now() / 1000));
    this.genesisTimestamp = now - this.head * BLOCK_SECONDS;
    this.viem = createPublicClient({ transport: custom({ request: ({ method, params }) => this.request(chainId, method, (params ?? []) as unknown[]) }) });
  }

  configs(): ChainConfig[] {
    return [{ id: this.chainId, rpcUrl: "fake://", mode: "live" }];
  }
  has(chainId: number) { return chainId === this.chainId; }
  mode(): "fork" | "live" { return "live"; }
  rpcUrl() { return "fake://"; }
  client() { return this.viem; }

  async request(_chainId: number, method: string, params: unknown[]): Promise<unknown> {
    this.log.push({ method, params });
    const blockOf = (tag: unknown) => (typeof tag === "string" && tag.startsWith("0x") ? BigInt(tag) : this.head);
    switch (method) {
      case "eth_chainId": return toHex(this.chainId);
      case "eth_blockNumber": return toHex(this.head);
      case "eth_getCode": {
        const c = this.contracts.get(String(params[0]).toLowerCase());
        if (!c) return "0x";
        return blockOf(params[1]) >= (c.createdAt ?? 1n) ? (c.code ?? "0x6001") : "0x";
      }
      case "eth_getStorageAt": {
        const c = this.contracts.get(String(params[0]).toLowerCase());
        return c?.storage?.[String(params[1]).toLowerCase()] ?? `0x${"0".repeat(64)}`;
      }
      case "eth_call": {
        const tx = params[0] as { to?: string; data?: Hex };
        const c = tx.to ? this.contracts.get(tx.to.toLowerCase()) : undefined;
        return c?.call?.(tx.data ?? "0x") ?? "0x";
      }
      case "eth_getBalance": return toHex(10n ** 18n);
      case "eth_getBlockByNumber": {
        const n = blockOf(params[0]);
        return { number: toHex(n), timestamp: toHex(this.genesisTimestamp + n * BLOCK_SECONDS), hash: `0x${"1".repeat(64)}`, parentHash: `0x${"0".repeat(64)}`, transactions: [], gasLimit: "0x1", gasUsed: "0x0", baseFeePerGas: "0x1", miner: `0x${"0".repeat(40)}`, nonce: "0x0", difficulty: "0x0", extraData: "0x", logsBloom: `0x${"0".repeat(512)}`, sha3Uncles: `0x${"0".repeat(64)}`, size: "0x0", stateRoot: `0x${"0".repeat(64)}`, receiptsRoot: `0x${"0".repeat(64)}`, transactionsRoot: `0x${"0".repeat(64)}`, uncles: [], mixHash: `0x${"0".repeat(64)}`, totalDifficulty: "0x0" };
      }
      default:
        throw new Error(`FakeChain: unsupported ${method}`);
    }
  }

  // Fork-only controls: not available in live mode.
  setBalance(): Promise<void> { return Promise.reject(new Error("live mode")); }
  dealErc20(): Promise<void> { return Promise.reject(new Error("live mode")); }
  setAutomine(): Promise<void> { return Promise.reject(new Error("live mode")); }
  mine(): Promise<void> { return Promise.reject(new Error("live mode")); }
  snapshot(): Promise<string> { return Promise.reject(new Error("live mode")); }
  revert(): Promise<void> { return Promise.reject(new Error("live mode")); }
  impersonate(_chainId: number, _address: Address): Promise<void> { return Promise.reject(new Error("live mode")); }
  setFaults(): void {}
  async addFromApp(): Promise<never> {
    throw new Error("this test chain can't add chains");
  }
  missing() {
    return [];
  }
  async close(): Promise<void> {}
}
