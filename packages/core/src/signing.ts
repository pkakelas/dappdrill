import { z } from "zod";
import { WalletProfileId } from "./script.js";

/** A request the dApp sent to the wallet. */
export const WalletRequest = z.object({
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
  chainId: z.number().int(),
  from: z.string().optional(),
  /** The injected wallet the dApp sent it to (matters when two are installed). */
  wallet: WalletProfileId.optional(),
  /** connect: eth_requestAccounts etc.; switch: chain changes; sign: anything that needs a signature. */
  kind: z.enum(["connect", "switch", "sign", "other"]),
  at: z.string(),
  /** What the wallet answered. */
  outcome: z.enum(["approved", "rejected", "errored", "pending"]).default("pending"),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export type WalletRequest = z.infer<typeof WalletRequest>;

export const SIGN_METHODS = [
  "eth_sendTransaction",
  "eth_signTransaction",
  "personal_sign",
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_sendCalls",
] as const;

export const Verdict = z.enum(["dangerous", "check", "consistent"]);
export type Verdict = z.infer<typeof Verdict>;

export const VERDICT_LABEL: Record<Verdict, string> = {
  dangerous: "Dangerous",
  check: "Check this",
  consistent: "Looks consistent",
};

export const CheckStatus = z.enum(["pass", "warn", "fail", "unverified", "skip"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const SigningCheck = z.object({
  id: z.enum([
    "ui-match",
    "verified-source",
    // No longer written; stored reviews may still hold it.
    "baseline",
    "contract-age",
    "proxy",
    "token",
    "known-bad",
    "approval",
    "simulation",
    "erc7730",
    "expectation",
  ]),
  label: z.string(),
  status: CheckStatus,
  detail: z.string(),
  /** What we couldn't confirm on the chain ourselves: indexer- or explorer-backed data, what a transaction would move. */
  unverified: z.boolean().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
});
export type SigningCheck = z.infer<typeof SigningCheck>;

export const DecodedArg = z.object({
  name: z.string(),
  type: z.string(),
  value: z.string(),
  /** Human form: "100.00 USDC", "Unlimited", "0x9f…c2 (HarborVault)". */
  display: z.string().optional(),
});
export type DecodedArg = z.infer<typeof DecodedArg>;

export const DecodedRequest = z.object({
  kind: z.enum(["transaction", "typedData", "message"]),
  to: z.string().optional(),
  contractName: z.string().optional(),
  functionName: z.string().optional(),
  /** e.g. approve(address,uint256) */
  signature: z.string().optional(),
  args: z.array(DecodedArg).default([]),
  /** Native value in wei (decimal string). */
  value: z.string().optional(),
  primaryType: z.string().optional(),
  domain: z.record(z.string(), z.unknown()).optional(),
  /** For personal_sign: the decoded text. */
  message: z.string().optional(),
  calldata: z.string().optional(),
  /** Where the ABI came from. */
  abiSource: z.enum(["sourcify", "explorer", "signature-db", "erc7730", "builtin", "none"]).optional(),
});
export type DecodedRequest = z.infer<typeof DecodedRequest>;

export const BalanceChange = z.object({
  owner: z.string(),
  /** "native" for ETH. */
  token: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().int().optional(),
  /** Signed raw amount (decimal string). */
  delta: z.string(),
  display: z.string(),
});
export type BalanceChange = z.infer<typeof BalanceChange>;

export const ApprovalGrant = z.object({
  standard: z.enum(["erc20", "permit", "permit2", "erc721-all", "erc1155-all", "erc721"]),
  token: z.string(),
  symbol: z.string().optional(),
  spender: z.string(),
  spenderName: z.string().optional(),
  /** Raw amount (decimal string); empty for "all" approvals. */
  amount: z.string(),
  display: z.string(),
  unlimited: z.boolean(),
  /** ISO date, for permits. */
  expiry: z.string().optional(),
});
export type ApprovalGrant = z.infer<typeof ApprovalGrant>;

/**
 * The signing review answers four questions: what it does, where it goes,
 * what it grants, and whether it matches the UI. Verdicts never say "safe".
 */
export const SigningReview = z.object({
  id: z.string(),
  requestId: z.string(),
  testId: z.string().optional(),
  stepIndex: z.number().int().optional(),
  runId: z.string().optional(),
  chainId: z.number().int(),
  method: z.string(),
  verdict: Verdict,
  /** "Approve USDC for 0x9f…c2". */
  title: z.string(),
  /** One or two plain sentences. */
  summary: z.string(),
  ui: z
    .object({
      buttonLabel: z.string().optional(),
      pageUrl: z.string().optional(),
      screenshot: z.string().optional(),
    })
    .default({}),
  decoded: DecodedRequest,
  simulation: z
    .object({
      status: z.enum(["ok", "reverted", "unavailable"]),
      balanceChanges: z.array(BalanceChange).default([]),
      revertReason: z.string().optional(),
    })
    .optional(),
  approvals: z.array(ApprovalGrant).default([]),
  checks: z.array(SigningCheck).default([]),
  /** Why we reached the verdict, plainly. */
  explanation: z.string(),
  /** What the dApp team should change. */
  advice: z.string().optional(),
  /** The same for the same request of the same step: test + step + method + target + function. */
  fingerprint: z.string(),
  createdAt: z.string(),
});
export type SigningReview = z.infer<typeof SigningReview>;
