import { z } from "zod";

export const EdgeCaseId = z.enum([
  "happy",
  "reject",
  "wrong-network",
  "unknown-chain",
  "switch-account",
  "two-wallets",
  "low-gas",
  "slow-rpc",
  "failing-rpc",
  "reload-mid-flow",
  "speed-up",
  "existing-approval",
  "revoked-approval",
]);
export type EdgeCaseId = z.infer<typeof EdgeCaseId>;

export interface EdgeCaseInfo {
  id: EdgeCaseId;
  /** Column header in the report matrix. */
  label: string;
  /** One-line plain description for the scan setup screen. */
  description: string;
  /** Needs fork control (balances, mining, RPC proxy); unavailable in live mode. */
  needsFork: boolean;
  /** On by default for new scans. */
  default: boolean;
}

export const EDGE_CASES: EdgeCaseInfo[] = [
  { id: "happy", label: "Happy path", description: "Approve everything, like a normal user.", needsFork: false, default: true },
  { id: "reject", label: "Reject", description: "Reject the request in the wallet (error 4001).", needsFork: false, default: true },
  { id: "wrong-network", label: "Wrong network", description: "Start the wallet on a different network.", needsFork: false, default: true },
  { id: "unknown-chain", label: "Unknown chain", description: "Wallet doesn't know the chain yet (error 4902).", needsFork: false, default: false },
  { id: "switch-account", label: "Switch account", description: "Switch to another account in the middle of the flow.", needsFork: false, default: true },
  { id: "two-wallets", label: "Two wallets", description: "Two browser wallets installed at once (EIP-6963).", needsFork: false, default: true },
  { id: "low-gas", label: "Low gas", description: "Not enough ETH to pay for gas.", needsFork: true, default: true },
  { id: "slow-rpc", label: "Slow RPC", description: "Every RPC call takes several seconds.", needsFork: true, default: true },
  { id: "failing-rpc", label: "Failing RPC", description: "Some RPC calls fail.", needsFork: true, default: false },
  { id: "reload-mid-flow", label: "Reload", description: "Reload the page while a transaction is pending.", needsFork: true, default: false },
  { id: "speed-up", label: "Speed up", description: "Replace a pending transaction with a faster one.", needsFork: true, default: false },
  { id: "existing-approval", label: "Already approved", description: "Token already approved before the flow starts.", needsFork: true, default: false },
  { id: "revoked-approval", label: "Revoked approval", description: "Approval revoked before the flow starts.", needsFork: true, default: false },
];

export function edgeCaseInfo(id: EdgeCaseId): EdgeCaseInfo {
  return EDGE_CASES.find((e) => e.id === id)!;
}

export const DEFAULT_EDGE_CASES: EdgeCaseId[] = EDGE_CASES.filter((e) => e.default).map((e) => e.id);
