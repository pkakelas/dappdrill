/**
 * What the request grants: ERC-20 approvals (approve / increaseAllowance),
 * NFT operator approvals, Permit2 approvals and permits, and typed-data permits.
 */
import type { Address } from "viem";
import type { ApprovalGrant } from "@dappdrill/core";
import type { Contracts, TokenInfo } from "./contract.js";
import type { DecodedCall } from "./decode-tx.js";
import type { DecodedTyped, TypedPermit } from "./decode-typed.js";
import { displayAmount, isUnlimited } from "./format.js";

export async function approvalsFromCalls(calls: DecodedCall[], contracts: Contracts): Promise<ApprovalGrant[]> {
  const out: ApprovalGrant[] = [];
  for (const call of calls) {
    const grant = await grantFromCall(call, contracts);
    if (grant) out.push(...grant);
  }
  return out;
}

export async function approvalsFromTyped(typed: DecodedTyped, contracts: Contracts): Promise<ApprovalGrant[]> {
  return Promise.all(typed.permits.map((p) => grantFromPermit(p, contracts)));
}

async function grantFromCall(call: DecodedCall, contracts: Contracts): Promise<ApprovalGrant[] | undefined> {
  const { functionName: fn, raw, to } = call;
  if (!fn) return undefined;
  const a = (i: number) => raw[i] as Address | undefined;
  // Small integer types (uint48 expirations) come back from viem as numbers.
  const n = (i: number) => (typeof raw[i] === "bigint" ? (raw[i] as bigint) : typeof raw[i] === "number" ? BigInt(raw[i] as number) : 0n);

  if (fn === "approve" && raw.length === 4 && to && a(0) && a(1)) {
    // Permit2.approve(token, spender, amount, expiration)
    return [await erc20Grant("permit2", a(0)!, a(1)!, n(2), contracts, { permit2: true, deadline: n(3) })];
  }
  if ((fn === "approve" || fn === "increaseAllowance") && to && a(0) && raw.length >= 2) {
    const token = await contracts.token(to);
    if (token?.standard === "erc721" && fn === "approve") {
      const spender = await contracts.info(a(0)!);
      return [{ standard: "erc721", token: to, symbol: token.symbol, spender: a(0)!, spenderName: spender.name, amount: n(1).toString(), display: `${token.symbol ?? "token"} #${n(1)}`, unlimited: false }];
    }
    return [await erc20Grant("erc20", to, a(0)!, n(1), contracts, { token })];
  }
  if (fn === "setApprovalForAll" && to && a(0) && raw[1] === true) {
    const [token, spender] = await Promise.all([contracts.token(to), contracts.info(a(0)!)]);
    const standard = token?.standard === "erc1155" ? "erc1155-all" : "erc721-all";
    return [{ standard, token: to, symbol: token?.symbol, spender: a(0)!, spenderName: spender.name, amount: "", display: `All ${token?.symbol ?? "tokens"}`, unlimited: true }];
  }
  if (fn === "permit" && to && raw.length === 7 && a(1)) {
    return [await erc20Grant("permit", to, a(1)!, n(2), contracts, { deadline: n(3) })];
  }
  if (fn === "permit" && to && raw.length === 8 && a(1)) {
    // DAI-style permit(holder, spender, nonce, expiry, allowed, v, r, s)
    const allowed = raw[4] === true;
    return [await erc20Grant("permit", to, a(1)!, allowed ? (1n << 256n) - 1n : 0n, contracts, { deadline: n(3) })];
  }
  if (fn === "permit" && raw.length === 3 && a(0) && raw[1] && typeof raw[1] === "object") {
    // Permit2.permit(owner, PermitSingle | PermitBatch, signature)
    const permit = raw[1] as { details: Permit2Detail | Permit2Detail[]; spender: Address };
    const details = Array.isArray(permit.details) ? permit.details : [permit.details];
    return Promise.all(details.map((d) => erc20Grant("permit2", d.token, permit.spender, d.amount, contracts, { permit2: true, deadline: d.expiration })));
  }
  if (fn === "PERMIT2_PERMIT" && raw[0] && typeof raw[0] === "object") {
    const permit = raw[0] as { details: Permit2Detail; spender: Address };
    return [await erc20Grant("permit2", permit.details.token, permit.spender, permit.details.amount, contracts, { permit2: true, deadline: permit.details.expiration })];
  }
  if (fn === "PERMIT2_PERMIT_BATCH" && raw[0] && typeof raw[0] === "object") {
    const permit = raw[0] as { details: Permit2Detail[]; spender: Address };
    return Promise.all(permit.details.map((d) => erc20Grant("permit2", d.token, permit.spender, d.amount, contracts, { permit2: true, deadline: d.expiration })));
  }
  return undefined;
}

interface Permit2Detail {
  token: Address;
  amount: bigint;
  expiration: bigint | number;
}

async function grantFromPermit(p: TypedPermit, contracts: Contracts): Promise<ApprovalGrant> {
  const grant = await erc20Grant(p.permit2 ? "permit2" : "permit", p.token, p.spender, p.amount, contracts, { permit2: p.permit2, deadline: p.deadline });
  if (p.transfer) grant.display = `${grant.display} (transfer)`;
  return grant;
}

async function erc20Grant(
  standard: ApprovalGrant["standard"],
  token: Address,
  spender: Address,
  amount: bigint,
  contracts: Contracts,
  opts: { permit2?: boolean; deadline?: bigint | number; token?: TokenInfo },
): Promise<ApprovalGrant> {
  const [t, s] = await Promise.all([opts.token ?? contracts.token(token), contracts.info(spender)]);
  const unlimited = isUnlimited(amount, { permit2: opts.permit2, totalSupply: t?.totalSupply });
  return {
    standard,
    token,
    symbol: t?.symbol,
    spender,
    spenderName: s.name,
    amount: amount.toString(),
    display: displayAmount(amount, t, { permit2: opts.permit2, totalSupply: t?.totalSupply }),
    unlimited,
    expiry: expiryIso(opts.deadline),
  };
}

function expiryIso(deadline: bigint | number | undefined): string | undefined {
  if (deadline === undefined) return undefined;
  const s = Number(deadline);
  // 0 and "forever" values (uint256 max and friends) mean no expiry.
  if (!Number.isFinite(s) || s <= 0 || s > 4_102_444_800) return undefined;
  return new Date(s * 1000).toISOString();
}
