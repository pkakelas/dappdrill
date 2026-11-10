/** Everything the reviewer gathered about one request, shared by checks, verdict and prose. */
import type { Address } from "viem";
import type { ApprovalGrant, DecodedRequest } from "@dappdrill/core";
import type { SigningInput } from "../types.js";
import type { ContractAge, ContractInfo, TokenInfo } from "./contract.js";
import type { DecodedMessage } from "./decode-message.js";
import type { DecodedCall } from "./decode-tx.js";
import type { DecodedTyped } from "./decode-typed.js";
import type { Erc7730Match } from "./erc7730.js";
import type { KnownBadResult } from "./known-bad.js";
import type { ParsedRequest } from "./request.js";
import type { Simulation } from "./simulate.js";

export interface Subject {
  info: ContractInfo;
  age?: ContractAge;
  implementationAge?: ContractAge;
}

export interface Facts {
  input: SigningInput;
  chainId: number;
  chainAvailable: boolean;
  nativeSymbol: string;
  pageHost?: string;
  parsed: ParsedRequest;
  from?: Address;
  /** Top-level calls (one, or several for an EIP-5792 batch). */
  calls: DecodedCall[];
  /** Every call including nested ones. */
  allCalls: DecodedCall[];
  typed?: DecodedTyped;
  message?: DecodedMessage;
  decoded: DecodedRequest;
  approvals: ApprovalGrant[];
  simulation?: Simulation;
  /** The transaction target, or the typed data's verifying contract. */
  target?: Subject;
  /** One entry per distinct approval spender. */
  spenders: Subject[];
  /** Tokens involved: approval tokens and the target when it is a token. */
  tokens: TokenInfo[];
  knownBad: KnownBadResult;
  erc7730?: Erc7730Match;
  fingerprint: string;
}

/** Contracts younger than this count as "new". */
export const NEW_CONTRACT_DAYS = 30;

export function nativeValue(facts: Facts): bigint {
  return facts.calls.reduce((sum, c) => sum + c.value, 0n);
}

/** Balance changes for the signer that are negative (something leaves the wallet). */
export function outgoing(facts: Facts) {
  const from = facts.from?.toLowerCase();
  return (facts.simulation?.balanceChanges ?? []).filter((c) => c.owner.toLowerCase() === from && BigInt(c.delta) < 0n);
}

/** True when the request puts value at stake: an approval, native value, or tokens leaving. */
export function hasStake(facts: Facts): boolean {
  return facts.approvals.length > 0 || nativeValue(facts) > 0n || outgoing(facts).length > 0;
}
