import { z } from "zod";

/**
 * A condition: something going wrong on a test's route (the wallet rejects, the RPC is slow).
 * The id is what the engine's replay switches on; the rest is the one place its name and
 * expected result are written, so the UI, the judge and the CLI read the same words.
 */
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

export interface ConditionInfo {
  id: EdgeCaseId;
  /** What users read: "Rejected in wallet". */
  name: string;
  /** What a well-behaved app does; shown to users and given to the judge. */
  expected: string;
  /** Needs fork control (balances, mining, RPC proxy); doesn't apply in live mode. */
  needsFork: boolean;
  /** Offered as a condition on a test. Engine-only cases (the happy path itself, approval states) are not. */
  offered: boolean;
  /** Pre-selected when adding conditions; what --unhappy and the assistant add. */
  default: boolean;
}

/** Every condition the replay knows, in the order they are shown and run. */
export const CONDITIONS: ConditionInfo[] = [
  { id: "happy", name: "Happy path", expected: "The test completes as written.", needsFork: false, offered: false, default: false },
  { id: "reject", name: "Rejected in wallet", expected: "The app shows that the request was rejected and lets the user try again.", needsFork: false, offered: true, default: true },
  { id: "slow-rpc", name: "Slow RPC", expected: "The app keeps working, just slower, and shows that it is loading.", needsFork: true, offered: true, default: true },
  { id: "wrong-network", name: "Wrong network", expected: "The app notices the wrong network and asks the wallet to switch before sending anything.", needsFork: false, offered: true, default: true },
  { id: "low-gas", name: "Not enough gas", expected: "The app tells the user there isn't enough ETH for gas and lets them try again.", needsFork: true, offered: true, default: true },
  { id: "switch-account", name: "Account switched", expected: "The app uses the newly selected account for everything that follows.", needsFork: false, offered: true, default: false },
  { id: "failing-rpc", name: "Failing RPC", expected: "The app retries, or shows a clear error, when an RPC call fails.", needsFork: true, offered: true, default: false },
  { id: "reload-mid-flow", name: "Reload while pending", expected: "After a reload the app shows the pending transaction and then its confirmation.", needsFork: true, offered: true, default: false },
  { id: "two-wallets", name: "Two wallets installed", expected: "The app uses the wallet the user picked when two are installed.", needsFork: false, offered: true, default: false },
  { id: "unknown-chain", name: "Chain unknown to wallet", expected: "The app adds the chain to the wallet when the wallet doesn't know it yet.", needsFork: false, offered: true, default: false },
  { id: "speed-up", name: "Sped-up transaction", expected: "The app notices the replaced transaction and shows it as confirmed.", needsFork: true, offered: true, default: false },
  { id: "existing-approval", name: "Already approved", expected: "The app reads the current allowance and skips the approval when it is enough.", needsFork: true, offered: false, default: false },
  { id: "revoked-approval", name: "Approval revoked", expected: "The app asks for a new approval when the old one is gone.", needsFork: true, offered: false, default: false },
];

/** The conditions a test can be given. */
export const OFFERED_CONDITIONS = CONDITIONS.filter((c) => c.offered);

export function conditionInfo(id: EdgeCaseId): ConditionInfo {
  return CONDITIONS.find((c) => c.id === id)!;
}

export const DEFAULT_EDGE_CASES: EdgeCaseId[] = CONDITIONS.filter((c) => c.default || c.id === "happy").map((c) => c.id);
