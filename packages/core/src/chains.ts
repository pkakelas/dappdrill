import { z } from "zod";

export interface ChainInfo {
  id: number;
  name: string;
  rpcUrl: string;
  nativeSymbol: string;
  explorer?: string;
  testnet: boolean;
}

export const KNOWN_CHAINS: ChainInfo[] = [
  { id: 1, name: "Ethereum", rpcUrl: "https://ethereum-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://etherscan.io", testnet: false },
  { id: 8453, name: "Base", rpcUrl: "https://base-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://basescan.org", testnet: false },
  { id: 42161, name: "Arbitrum", rpcUrl: "https://arbitrum-one-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://arbiscan.io", testnet: false },
  { id: 10, name: "Optimism", rpcUrl: "https://optimism-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://optimistic.etherscan.io", testnet: false },
  { id: 137, name: "Polygon", rpcUrl: "https://polygon-bor-rpc.publicnode.com", nativeSymbol: "POL", explorer: "https://polygonscan.com", testnet: false },
  { id: 56, name: "BNB Chain", rpcUrl: "https://bsc-rpc.publicnode.com", nativeSymbol: "BNB", explorer: "https://bscscan.com", testnet: false },
  { id: 11155111, name: "Sepolia", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://sepolia.etherscan.io", testnet: true },
  { id: 84532, name: "Base Sepolia", rpcUrl: "https://base-sepolia-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://sepolia.basescan.org", testnet: true },
  { id: 421614, name: "Arbitrum Sepolia", rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc", nativeSymbol: "ETH", explorer: "https://sepolia.arbiscan.io", testnet: true },
  { id: 11155420, name: "OP Sepolia", rpcUrl: "https://optimism-sepolia-rpc.publicnode.com", nativeSymbol: "ETH", explorer: "https://sepolia-optimism.etherscan.io", testnet: true },
  { id: 129302, name: "pod testnet", rpcUrl: "https://staging-rpc.podtestnet.dev", nativeSymbol: "ETH", testnet: true },
  { id: 31337, name: "Local", rpcUrl: "http://127.0.0.1:8545", nativeSymbol: "ETH", testnet: true },
];

/** Chains that hold real money. Only for saying so: nothing is refused because a chain is one of these. */
export const MAINNET_CHAIN_IDS = new Set([1, 8453, 42161, 10, 137, 56, 43114, 324, 59144, 534352, 5000, 81457, 7777777, 100, 250]);

export function chainInfo(id: number): ChainInfo | undefined {
  return KNOWN_CHAINS.find((c) => c.id === id);
}

export function chainName(id: number): string {
  return chainInfo(id)?.name ?? `Chain ${id}`;
}

/** A chain the app uses, reached through its real RPC. Nothing is copied: what a test signs lands on this chain. */
export const ChainConfig = z.object({
  id: z.number().int(),
  name: z.string().optional(),
  rpcUrl: z.string(),
  /**
   * Added mid-run because the app asked the wallet for it (wallet_addEthereumChain), or asked
   * it to sign typed data bound to it. Loading the page doesn't show such chains (they sit
   * behind a sign-in), so later scans start with them.
   */
  fromApp: z.boolean().optional(),
  /** Ethereum, given to the wallet when the page shows no chain. Dropped once the app's own chain is known. */
  fallback: z.boolean().optional(),
});
export type ChainConfig = z.infer<typeof ChainConfig>;

/**
 * The chains kept for an app with the ones it was just seen to use, or nothing when none of them is new.
 * A chain is only ever added here, and the Ethereum fallback goes once a chain of the app's own is known.
 */
export function withFoundChains(kept: ChainConfig[], found: ChainConfig[]): ChainConfig[] | undefined {
  const added = found.filter((c) => !c.fallback && !kept.some((k) => k.id === c.id));
  return added.length ? [...kept.filter((c) => !c.fallback), ...added] : undefined;
}
