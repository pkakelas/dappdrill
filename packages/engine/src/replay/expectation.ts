/**
 * Deterministic check of a WalletExpectation against what the dApp actually
 * asked the wallet to sign. Uses the signing reviewer's decoding when one ran,
 * otherwise a built-in ABI of the functions dApps most often ask for.
 */
import { decodeFunctionData, maxUint160, maxUint256, parseAbi, parseUnits, type Hex as ViemHex } from "viem";
import { applyParams, formatUnitsPlain, matchesFunction, type DecodedRequest, type WalletExpectation, type WalletRequest } from "@dappdrill/core";
import type { ChainController } from "../types.js";

const PERMIT2 = "0x000000000022d473030f116ddee9f6b43ac78ba3";

const BUILTIN_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function setApprovalForAll(address operator, bool approved)",
  "function approve(address token, address spender, uint160 amount, uint48 expiration)",
  "function deposit()",
  "function deposit(uint256 amount)",
  "function deposit(uint256 assets, address receiver)",
  "function withdraw(uint256 amount)",
  "function withdraw(uint256 assets, address receiver, address owner)",
  "function mint(uint256 shares, address receiver)",
  "function mint(address to, uint256 amount)",
  "function redeem(uint256 shares, address receiver, address owner)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claim()",
  "function multicall(bytes[] data)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
]);

const ERC20_META_ABI = parseAbi(["function decimals() view returns (uint8)", "function asset() view returns (address)"]);

/** Decode a wallet request well enough for the expectation check and the "wallet was asked for" line. */
export function decodeBuiltin(req: WalletRequest): DecodedRequest {
  const params = Array.isArray(req.params) ? req.params : [];
  if (req.method === "eth_sendTransaction" || req.method === "eth_signTransaction") {
    const tx = (params[0] ?? {}) as { to?: string; data?: string; input?: string; value?: string };
    const calldata = (tx.data ?? tx.input ?? "0x") as ViemHex;
    const base: DecodedRequest = { kind: "transaction", to: tx.to?.toLowerCase(), value: tx.value ? BigInt(tx.value).toString() : undefined, calldata, args: [], abiSource: "none" };
    if (calldata.length < 10) return base;
    try {
      const d = decodeFunctionData({ abi: BUILTIN_ABI, data: calldata });
      const fn = BUILTIN_ABI.find((f) => f.type === "function" && f.name === d.functionName && f.inputs.length === (d.args?.length ?? 0));
      const args = (d.args ?? []).map((v, i) => {
        const input = fn?.inputs[i];
        return { name: input?.name ?? `arg${i}`, type: input?.type ?? "unknown", value: String(v) };
      });
      return { ...base, functionName: d.functionName, signature: fn ? `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})` : undefined, args, abiSource: "builtin" };
    } catch {
      return base;
    }
  }
  if (req.method.startsWith("eth_signTypedData")) {
    try {
      const raw = params[1];
      const typed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return { kind: "typedData", primaryType: typed?.primaryType, domain: typed?.domain, message: JSON.stringify(typed?.message), args: [], abiSource: "none" };
    } catch {
      return { kind: "typedData", args: [], abiSource: "none" };
    }
  }
  const raw = req.method === "eth_sign" ? params[1] : params[0];
  let message = typeof raw === "string" ? raw : JSON.stringify(raw);
  if (typeof raw === "string" && /^0x[0-9a-fA-F]*$/.test(raw)) {
    try {
      message = Buffer.from(raw.slice(2), "hex").toString("utf8");
    } catch {
      /* keep hex */
    }
  }
  return { kind: "message", message, args: [], abiSource: "none" };
}

/** Plain "the wallet was asked for" line for issues and reviews. */
export function describeAsked(decoded: DecodedRequest, req: WalletRequest): string {
  if (decoded.kind === "message") return `personal_sign of "${(decoded.message ?? "").slice(0, 80)}"`;
  if (decoded.kind === "typedData") return `${req.method} ${decoded.primaryType ?? ""}`.trim();
  const fn = decoded.functionName ? `${decoded.functionName}(${decoded.args.map((a) => a.display ?? a.value).join(", ")})` : decoded.calldata && decoded.calldata !== "0x" ? `calldata ${decoded.calldata.slice(0, 10)}…` : "plain transfer";
  return `${fn} to ${decoded.to ?? "contract creation"}${decoded.value && decoded.value !== "0" ? ` with ${formatUnitsPlain(BigInt(decoded.value), 18)} ETH` : ""}`;
}

export interface ExpectationResult {
  ok: boolean;
  /** Mismatches that fail the step. */
  problems: string[];
  /** Things we couldn't verify (unknown selector, no decimals). */
  warnings: string[];
}

export async function checkExpectation(
  exp: WalletExpectation | undefined,
  req: WalletRequest,
  decoded: DecodedRequest,
  chains: ChainController,
  params: Record<string, string>,
): Promise<ExpectationResult> {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!exp) return { ok: true, problems, warnings };

  if (exp.kind && exp.kind !== decoded.kind) problems.push(`expected a ${exp.kind} request, the dApp sent ${req.method}`);
  if (exp.to && decoded.to && exp.to.toLowerCase() !== decoded.to.toLowerCase()) problems.push(`expected the transaction to go to ${exp.to}, it goes to ${decoded.to}`);
  if (exp.to && decoded.kind === "transaction" && !decoded.to) problems.push(`expected the transaction to go to ${exp.to}, it has no recipient`);

  if (exp.functionName && !matchesFunction(exp.functionName, decoded)) {
    if (!decoded.functionName) warnings.push(`could not decode the called function (selector ${decoded.calldata?.slice(0, 10) ?? "none"}); expected ${exp.functionName}`);
    else problems.push(`expected a call to ${exp.functionName}, the dApp calls ${decoded.functionName}`);
  }

  const spender = spenderOf(decoded);
  if (exp.spenderMustBe) {
    if (!spender) warnings.push("expected a spender but the request grants no approval");
    else if (spender !== exp.spenderMustBe.toLowerCase() && !(exp.alsoAcceptPermit2 && spender === PERMIT2)) {
      problems.push(`approval spender should be ${exp.spenderMustBe}, it is ${spender}`);
    }
  }

  const amount = amountOf(decoded);
  if (exp.failIfUnlimited && amount !== undefined && isUnlimited(amount)) problems.push("the approval is unlimited");

  if (exp.amountMustEqual) {
    const human = applyParams(exp.amountMustEqual, params);
    if (amount === undefined) warnings.push(`expected amount ${human} but the request carries no amount`);
    else {
      const decimals = await tokenDecimals(chains, req.chainId, tokenOf(decoded));
      if (decimals === undefined) warnings.push(`could not read token decimals to verify the amount ${human}`);
      else {
        let want: bigint | undefined;
        try {
          want = parseUnits(human, decimals);
        } catch {
          warnings.push(`amount "${human}" is not a number`);
        }
        if (want !== undefined && want !== amount) {
          problems.push(`amount should be ${human}, the request carries ${formatUnitsPlain(amount, decimals)}${isUnlimited(amount) ? " (unlimited)" : ""}`);
        }
      }
    }
  }
  return { ok: problems.length === 0, problems, warnings };
}

export function spenderOf(decoded: DecodedRequest): string | undefined {
  if (decoded.kind === "transaction") {
    const byName = decoded.args.find((a) => a.name === "spender" || a.name === "operator");
    return byName?.value.toLowerCase();
  }
  if (decoded.kind === "typedData" && decoded.message) {
    try {
      const m = JSON.parse(decoded.message);
      const s = m?.spender ?? m?.details?.spender ?? m?.details?.[0]?.spender;
      return typeof s === "string" ? s.toLowerCase() : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function amountOf(decoded: DecodedRequest): bigint | undefined {
  if (decoded.kind === "transaction") {
    const named = decoded.args.find((a) => ["amount", "value", "assets", "shares", "addedValue", "wad"].includes(a.name) && /^uint/.test(a.type));
    const any = named ?? decoded.args.find((a) => /^uint(256|160)$/.test(a.type));
    if (any) return BigInt(any.value);
    if (decoded.value && decoded.value !== "0" && decoded.args.length === 0) return BigInt(decoded.value);
    return undefined;
  }
  if (decoded.kind === "typedData" && decoded.message) {
    try {
      const m = JSON.parse(decoded.message);
      const v = m?.value ?? m?.amount ?? m?.details?.amount;
      return v !== undefined ? BigInt(v) : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Token whose decimals apply to the amount: the approve target, permit2's token arg, or the typed-data verifying contract. */
function tokenOf(decoded: DecodedRequest): string | undefined {
  if (decoded.kind === "transaction") return decoded.args.find((a) => a.name === "token")?.value.toLowerCase() ?? decoded.to;
  if (decoded.kind === "typedData") {
    const vc = decoded.domain?.verifyingContract;
    return typeof vc === "string" ? vc.toLowerCase() : undefined;
  }
  return undefined;
}

export function isUnlimited(amount: bigint): boolean {
  return amount === maxUint256 || amount === maxUint160 || amount >= 1n << 255n;
}

const decimalsCache = new Map<string, number | undefined>();

export async function tokenDecimals(chains: ChainController, chainId: number, token: string | undefined): Promise<number | undefined> {
  if (!token) return undefined;
  const key = `${chainId}:${token}`;
  if (decimalsCache.has(key)) return decimalsCache.get(key);
  const client = chains.client(chainId);
  let decimals: number | undefined;
  try {
    decimals = await client.readContract({ address: token as ViemHex, abi: ERC20_META_ABI, functionName: "decimals" });
  } catch {
    try {
      // ERC-4626 vault: the amount is in the underlying asset's decimals.
      const asset = await client.readContract({ address: token as ViemHex, abi: ERC20_META_ABI, functionName: "asset" });
      decimals = await client.readContract({ address: asset, abi: ERC20_META_ABI, functionName: "decimals" });
    } catch {
      decimals = undefined;
    }
  }
  decimalsCache.set(key, decimals);
  return decimals;
}
