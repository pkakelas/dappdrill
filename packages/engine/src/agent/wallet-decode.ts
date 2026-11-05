/**
 * Reads a wallet request the way the agent needs it: a one-line summary for
 * the model, a WalletExpectation to record in the test, and the raw amounts
 * in it so typed values can be turned into a {{amount}} parameter.
 */
import { decodeFunctionData, maxUint256, parseAbi, parseUnits, type Hex } from "viem";
import type { WalletExpectation, WalletRequest } from "@dappdrill/core";

/** Functions dApps call most; anything else is shown by selector. */
const KNOWN_ABI = parseAbi([
  "function approve(address spender, uint256 amount)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function deposit(uint256 amount)",
  "function deposit(uint256 assets, address receiver)",
  "function deposit()",
  "function withdraw(uint256 amount)",
  "function withdraw(uint256 assets, address receiver, address owner)",
  "function redeem(uint256 shares, address receiver, address owner)",
  "function mint(uint256 shares, address receiver)",
  "function mint(address to, uint256 amount)",
  "function stake(uint256 amount)",
  "function unstake(uint256 amount)",
  "function claim()",
  "function claimRewards()",
  "function getReward()",
  "function harvest()",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)",
  "function multicall(bytes[] data)",
  "function execute(bytes commands, bytes[] inputs, uint256 deadline)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function setApprovalForAll(address operator, bool approved)",
]);

export interface DecodedRequest {
  kind: "transaction" | "message" | "typedData" | "other";
  /** One line for the model: "eth_sendTransaction to 0x2222…2222: approve(spender=0x1111…1111, amount=12500000)". */
  summary: string;
  expectation: WalletExpectation;
  /** Every uint amount in the call (args and value), for matching against typed values. */
  amounts: bigint[];
  unlimitedApproval: boolean;
}

export function decodeWalletRequest(req: WalletRequest): DecodedRequest {
  const params = Array.isArray(req.params) ? req.params : [];
  switch (req.method) {
    case "eth_sendTransaction":
    case "eth_signTransaction":
      return decodeTransaction(req.method, params[0] as { to?: string; data?: string; value?: string } | undefined);
    case "personal_sign":
    case "eth_sign":
      return {
        kind: "message",
        summary: `${req.method}: "${clip(messageText(params, req.method), 120)}"`,
        expectation: { kind: "message" },
        amounts: [],
        unlimitedApproval: false,
      };
    case "eth_signTypedData":
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4":
      return decodeTypedData(req.method, params);
    default:
      return { kind: "other", summary: `${req.method} ${clip(JSON.stringify(req.params ?? null), 160)}`, expectation: {}, amounts: [], unlimitedApproval: false };
  }
}

function decodeTransaction(method: string, tx: { to?: string; data?: string; value?: string } | undefined): DecodedRequest {
  const to = tx?.to?.toLowerCase();
  const data = (tx?.data ?? "0x") as Hex;
  const value = tx?.value ? BigInt(tx.value) : 0n;
  const expectation: WalletExpectation = { kind: "transaction", to };
  const amounts: bigint[] = value > 0n ? [value] : [];
  let call = data.length > 2 ? `calldata ${data.slice(0, 10)}` : "plain transfer";
  let unlimitedApproval = false;

  if (data.length >= 10) {
    try {
      const { functionName, args } = decodeFunctionData({ abi: KNOWN_ABI, data });
      expectation.functionName = functionName;
      const argList = [...((args ?? []) as readonly unknown[])];
      for (const a of flatten(argList)) if (typeof a === "bigint") amounts.push(a);
      if (functionName === "approve" || functionName === "setApprovalForAll") {
        expectation.spenderMustBe = String(argList[0]).toLowerCase();
        unlimitedApproval = functionName === "setApprovalForAll" || argList[1] === maxUint256;
        // A bounded approval that later turns unlimited is a regression. An unlimited one is
        // recorded as it is; the signing review reports it.
        if (!unlimitedApproval) expectation.failIfUnlimited = true;
      }
      call = `${functionName}(${argList.map(fmtArg).join(", ")})`;
    } catch {
      expectation.functionName = data.slice(0, 10);
    }
  }
  const valueText = value > 0n ? ` value=${value}` : "";
  return { kind: "transaction", summary: `${method} to ${short(to)}: ${call}${valueText}`, expectation, amounts, unlimitedApproval };
}

function decodeTypedData(method: string, params: unknown[]): DecodedRequest {
  const raw = typeof params[1] === "string" ? params[1] : typeof params[0] === "string" ? params[0] : undefined;
  let typed: { primaryType?: string; domain?: { name?: string; verifyingContract?: string }; message?: Record<string, unknown> } | undefined;
  try {
    typed = raw ? JSON.parse(raw) : (params[1] as typeof typed);
  } catch {
    typed = undefined;
  }
  const expectation: WalletExpectation = { kind: "typedData" };
  const amounts: bigint[] = [];
  const primary = typed?.primaryType ?? "?";
  const msg = typed?.message ?? {};
  const spender = (msg.spender ?? (msg.details as { spender?: unknown } | undefined)?.spender) as string | undefined;
  if (spender) expectation.spenderMustBe = String(spender).toLowerCase();
  for (const v of flatten(Object.values(msg))) {
    if (typeof v === "bigint") amounts.push(v);
    else if (typeof v === "string" && /^\d+$/.test(v) && v.length > 1) amounts.push(BigInt(v));
  }
  const unlimited = amounts.some((a) => a >= maxUint256 / 2n);
  if (/permit/i.test(primary) && !unlimited) expectation.failIfUnlimited = true;
  const domain = typed?.domain?.name ? ` (${typed.domain.name})` : "";
  return {
    kind: "typedData",
    summary: `${method} ${primary}${domain}: ${clip(JSON.stringify(msg, bigintSafe), 200)}`,
    expectation,
    amounts,
    unlimitedApproval: unlimited,
  };
}

/** Which of the values the user typed produced an amount in this request, with the decimals used. */
export function matchTypedAmount(typed: string[], amounts: bigint[]): { typed: string; decimals: number } | undefined {
  for (const t of typed) {
    const clean = t.replace(/[,\s]/g, "");
    if (!/^\d*\.?\d+$/.test(clean) || Number(clean) <= 0) continue;
    for (let d = 0; d <= 18; d++) {
      let units: bigint;
      try {
        units = parseUnits(clean, d);
      } catch {
        continue;
      }
      if (units > 0n && amounts.includes(units)) return { typed: t, decimals: d };
    }
  }
  return undefined;
}

function messageText(params: unknown[], method: string): string {
  const raw = method === "personal_sign" ? params[0] : params[1];
  if (typeof raw !== "string") return "";
  if (/^0x[0-9a-f]*$/i.test(raw)) {
    try {
      return new TextDecoder().decode(Uint8Array.from(raw.slice(2).match(/../g)?.map((h) => parseInt(h, 16)) ?? []));
    } catch {
      return raw;
    }
  }
  return raw;
}

function flatten(values: unknown[]): unknown[] {
  return values.flatMap((v) => (Array.isArray(v) ? flatten(v) : v && typeof v === "object" ? flatten(Object.values(v)) : [v]));
}

function fmtArg(a: unknown): string {
  if (typeof a === "bigint") return a === maxUint256 ? "MAX_UINT256" : a.toString();
  if (typeof a === "string") return a.startsWith("0x") && a.length === 42 ? short(a) : clip(a, 40);
  if (Array.isArray(a)) return `[${a.map(fmtArg).join(", ")}]`;
  if (a && typeof a === "object") return `{${Object.entries(a).map(([k, v]) => `${k}=${fmtArg(v)}`).join(", ")}}`;
  return String(a);
}

function bigintSafe(_k: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

export function short(addr: string | undefined): string {
  if (!addr) return "(none)";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
