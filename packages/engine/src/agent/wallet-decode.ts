/**
 * Reads a wallet request the way the agent needs it: a one-line summary for
 * the model, a WalletExpectation to record in the test, and the raw amounts
 * in it so typed values can be turned into a {{amount}} parameter.
 */
import { decodeFunctionData, formatEther, formatUnits, maxUint256, parseAbi, parseUnits, type Hex } from "viem";
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
  /** What is asked, in a word or two, for someone watching: the function called ("approve"), "a transfer", "a message", the typed data's type ("Permit"). */
  asks: string;
  /**
   * The request as its owner reads it, in a phrase that completes "The wallet was asked to …":
   * "approve 0x1111…1111 to spend 12500000 of the token at 0x2222…2222". An amount is in the token's
   * smallest unit, as the request has it, unless the token's units were given: then it is "12.5 USDC".
   */
  words: string;
  /** The token the amount in `words` is of, when the request says which: the one to read the units of. */
  token?: string;
  expectation: WalletExpectation;
  /** Every uint amount in the call (args and value), for matching against typed values. */
  amounts: bigint[];
  unlimitedApproval: boolean;
}

/** What an amount of a token is counted in, as its contract says. */
export interface TokenUnits {
  decimals: number;
  symbol?: string;
}

/** `units` are those of the request's `token`, when they have been read: only `words` changes with them. */
export function decodeWalletRequest(req: WalletRequest, units?: TokenUnits): DecodedRequest {
  const params = Array.isArray(req.params) ? req.params : [];
  switch (req.method) {
    case "eth_sendTransaction":
    case "eth_signTransaction":
      return decodeTransaction(req.method, params[0] as { to?: unknown; data?: unknown; value?: unknown } | undefined, units);
    case "personal_sign":
    case "eth_sign": {
      const text = messageText(params, req.method).trim();
      return {
        kind: "message",
        summary: `${req.method}: "${clip(messageText(params, req.method), 400)}"`,
        asks: "a message",
        words: text ? `sign the message “${clip(text, 200)}”` : "sign a message",
        expectation: { kind: "message" },
        amounts: [],
        unlimitedApproval: false,
      };
    }
    case "eth_signTypedData":
    case "eth_signTypedData_v3":
    case "eth_signTypedData_v4":
      return decodeTypedData(req.method, params, units);
    default:
      return { kind: "other", summary: `${req.method} ${clip(JSON.stringify(req.params ?? null), 160)}`, asks: req.method, words: `answer ${req.method}`, expectation: {}, amounts: [], unlimitedApproval: false };
  }
}

function decodeTransaction(method: string, tx: { to?: unknown; data?: unknown; value?: unknown } | undefined, units?: TokenUnits): DecodedRequest {
  // The request comes from the page as it is, so any field may be missing or malformed.
  const to = typeof tx?.to === "string" ? tx.to.toLowerCase() : undefined;
  const data = (typeof tx?.data === "string" ? tx.data : "0x") as Hex;
  const value = toBigInt(tx?.value);
  const expectation: WalletExpectation = { kind: "transaction", to };
  const amounts: bigint[] = value > 0n ? [value] : [];
  // A call we can't decode still says how much follows its selector: read as "0xa98b3cbd" alone, it looks like a call with nothing in it.
  const args = Math.max(0, (data.length - 10) / 2);
  let call = data.length > 2 ? `calldata ${data.slice(0, 10)}${args ? ` and ${args} bytes of arguments, not decoded` : ""}` : "plain transfer";
  let asks = data.length > 2 ? "a transaction" : "a transfer";
  const coin = value > 0n ? `${formatEther(value)} of the chain's coin` : undefined;
  let words = data.length > 2 ? `send ${short(to)} a call we can't read (${data.slice(0, 10)})${coin ? `, with ${coin}` : ""}` : `send ${coin ?? "nothing"} to ${short(to)}`;
  let unlimitedApproval = false;
  let token: string | undefined;

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
      asks = functionName;
      if (functionName === "approve" || functionName === "transfer") token = to;
      if (functionName === "approve") words = `approve ${fmtArg(argList[0])} to spend ${amountOf(argList[1], to, units, unlimitedApproval)}`;
      else if (functionName === "transfer") words = `transfer ${amountOf(argList[1], to, units)} to ${fmtArg(argList[0])}`;
      else if (functionName === "setApprovalForAll") words = argList[1] ? `approve ${fmtArg(argList[0])} to move every token of ${short(to)}` : `take back the approval of ${fmtArg(argList[0])} on ${short(to)}`;
      else words = `call ${call} on ${short(to)}${coin ? `, with ${coin}` : ""}`;
    } catch {
      expectation.functionName = data.slice(0, 10);
    }
  }
  const valueText = value > 0n ? ` value=${value}` : "";
  return { kind: "transaction", summary: `${method} to ${short(to)}: ${call}${valueText}`, asks, words, token, expectation, amounts, unlimitedApproval };
}

function decodeTypedData(method: string, params: unknown[], units?: TokenUnits): DecodedRequest {
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
  const named = typed?.primaryType ? `${/^[aeiou]/i.test(primary) ? "an" : "a"} ${primary}${domain}` : `typed data${domain}`;
  const details = msg.details as { token?: unknown; amount?: unknown } | undefined;
  const allowed = msg.value ?? msg.amount ?? details?.amount;
  // A token's own permit is verified by the token. Permit2 names the token in the message.
  const at = details?.token ?? (/permit/i.test(primary) && allowed !== undefined ? typed?.domain?.verifyingContract : undefined);
  const token = typeof at === "string" ? at.toLowerCase() : undefined;
  const fields = Object.entries(msg).map(([k, v]) => `${k} ${fmtArg(v)}`).join(", ");
  // A permit is an approval by signature, so it reads like one. Anything else is said by its fields.
  const words = spender ? `sign ${named} that lets ${fmtArg(spender)} spend ${allowed !== undefined || unlimited ? amountOf(allowed, undefined, units, unlimited) : "the account's tokens"}` : `sign ${named}${fields ? `: ${clip(fields, 200)}` : ""}`;
  return {
    kind: "typedData",
    summary: `${method} ${primary}${domain}: ${clip(JSON.stringify(msg, bigintSafe), 200)}`,
    asks: typed?.primaryType ?? "typed data",
    words,
    token,
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

/** A hex or decimal amount, or 0 when it is neither. */
function toBigInt(v: unknown): bigint {
  if (typeof v !== "string" && typeof v !== "number" && typeof v !== "bigint") return 0n;
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
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

/**
 * An amount of a token as its owner reads it: "12.5 USDC" once the token's units are known, else the
 * request's own figure. `at` is the token's address, said when nothing better names the token.
 */
function amountOf(raw: unknown, at: string | undefined, units: TokenUnits | undefined, unlimited = false): string {
  const where = at ? ` of the token at ${short(at)}` : "";
  if (unlimited) return `an unlimited amount${units?.symbol ? ` of ${units.symbol}` : where}`;
  if (!units || !/^\d+$/.test(String(raw))) return `${fmtArg(raw)}${where}`;
  return `${formatUnits(BigInt(String(raw)), units.decimals)}${units.symbol ? ` ${units.symbol}` : where}`;
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
