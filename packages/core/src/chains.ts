import { z } from "zod";

export interface ChainInfo {
  id: number;
  name: string;
  rpcUrl: string;
  /** Other public RPCs for it, tried when `rpcUrl` can't serve a fork for a whole run (see the engine's chain/upstream.ts). */
  fallbackRpcs?: string[];
  nativeSymbol: string;
  explorer?: string;
  testnet: boolean;
  /** False when Anvil can't fork it (non-standard RPC); such chains need live mode. */
  forkable: boolean;
}

export const KNOWN_CHAINS: ChainInfo[] = [
  { id: 1, name: "Ethereum", rpcUrl: "https://ethereum-rpc.publicnode.com", fallbackRpcs: ["https://eth.drpc.org", "https://rpc.mevblocker.io"], nativeSymbol: "ETH", explorer: "https://etherscan.io", testnet: false, forkable: true },
  { id: 8453, name: "Base", rpcUrl: "https://base-rpc.publicnode.com", fallbackRpcs: ["https://mainnet.base.org", "https://base.drpc.org"], nativeSymbol: "ETH", explorer: "https://basescan.org", testnet: false, forkable: true },
  { id: 42161, name: "Arbitrum", rpcUrl: "https://arbitrum-one-rpc.publicnode.com", fallbackRpcs: ["https://arb1.arbitrum.io/rpc", "https://1rpc.io/arb"], nativeSymbol: "ETH", explorer: "https://arbiscan.io", testnet: false, forkable: true },
  { id: 10, name: "Optimism", rpcUrl: "https://optimism-rpc.publicnode.com", fallbackRpcs: ["https://mainnet.optimism.io", "https://optimism.drpc.org"], nativeSymbol: "ETH", explorer: "https://optimistic.etherscan.io", testnet: false, forkable: true },
  { id: 137, name: "Polygon", rpcUrl: "https://polygon-bor-rpc.publicnode.com", fallbackRpcs: ["https://polygon.drpc.org"], nativeSymbol: "POL", explorer: "https://polygonscan.com", testnet: false, forkable: true },
  { id: 56, name: "BNB Chain", rpcUrl: "https://bsc-rpc.publicnode.com", fallbackRpcs: ["https://bsc.drpc.org"], nativeSymbol: "BNB", explorer: "https://bscscan.com", testnet: false, forkable: true },
  { id: 11155111, name: "Sepolia", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://sepolia.etherscan.io", testnet: true, forkable: true },
  { id: 84532, name: "Base Sepolia", rpcUrl: "https://base-sepolia-rpc.publicnode.com", fallbackRpcs: ["https://sepolia.base.org"], nativeSymbol: "ETH", explorer: "https://sepolia.basescan.org", testnet: true, forkable: true },
  { id: 421614, name: "Arbitrum Sepolia", rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc", nativeSymbol: "ETH", explorer: "https://sepolia.arbiscan.io", testnet: true, forkable: true },
  { id: 11155420, name: "OP Sepolia", rpcUrl: "https://optimism-sepolia-rpc.publicnode.com", fallbackRpcs: ["https://sepolia.optimism.io"], nativeSymbol: "ETH", explorer: "https://sepolia-optimism.etherscan.io", testnet: true, forkable: true },
  { id: 129302, name: "pod testnet", rpcUrl: "https://staging-rpc.podtestnet.dev", nativeSymbol: "ETH", testnet: true, forkable: false },
  { id: 31337, name: "Local", rpcUrl: "http://127.0.0.1:8545", nativeSymbol: "ETH", testnet: true, forkable: true },
];

/** Chains that hold real money. Live mode refuses them unless explicitly allowed. */
export const MAINNET_CHAIN_IDS = new Set([1, 8453, 42161, 10, 137, 56, 43114, 324, 59144, 534352, 5000, 81457, 7777777, 100, 250]);

export function chainInfo(id: number): ChainInfo | undefined {
  return KNOWN_CHAINS.find((c) => c.id === id);
}

export function chainName(id: number): string {
  return chainInfo(id)?.name ?? `Chain ${id}`;
}

/**
 * fork: an Anvil fork of `rpcUrl` pinned at a block; all writes stay local.
 * live: requests go to the real (testnet) RPC, signed with a funded test key.
 */
export const ChainMode = z.enum(["fork", "live"]);
export type ChainMode = z.infer<typeof ChainMode>;

export const ChainConfig = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  rpcUrl: z.string(),
  mode: ChainMode.default("fork"),
  /** Pinned fork block (decimal string). Set by the engine at scan time and reused by replays. */
  forkBlock: z.string().optional(),
  /**
   * Added mid-run because the app asked the wallet for it (wallet_addEthereumChain), or asked
   * it to sign typed data bound to it. Loading the page doesn't show such chains (they sit
   * behind a sign-in), so later scans start with them.
   */
  fromApp: z.boolean().optional(),
  /** The Ethereum fork a scan starts when the page shows no chain. Dropped once the app's own chain is known. */
  fallback: z.boolean().optional(),
});
export type ChainConfig = z.infer<typeof ChainConfig>;
