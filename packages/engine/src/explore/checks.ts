/**
 * Deciding a check. The explorer says what should be true; this looks at the page, the wallet and
 * the chain and says whether it is. There is no way to pass a check by saying so, and a check
 * that can't be made comes back as "error", not as a pass.
 */
import { erc20Abi, formatEther, formatUnits } from "viem";
import type { CheckAssert, ExploreCheckStatus, WalletRequest } from "@dappdrill/core";
import { decodeWalletRequest } from "../agent/wallet-decode.js";
import { settle } from "../agent/tools.js";
import type { DrillSession, Hex } from "../types.js";

export interface CheckResult {
  status: ExploreCheckStatus;
  evidence: string;
}

const TX_WAIT_MS = 15_000;
const SHOW_WAIT_MS = 3_000;

/** `since`: wallet requests before this index belong to an earlier path. */
export async function evaluateCheck(session: DrillSession, assert: CheckAssert, since = 0): Promise<CheckResult> {
  await settle(session);
  const value = assert.value?.trim();
  const signs = session.wallet.requests().slice(since).filter((r) => r.kind === "sign");
  try {
    switch (assert.kind) {
      case "shows":
        if (!value) return missing("the text to look for");
        return (await visible(session, value)) ? { status: "pass", evidence: `Shows “${value}”.` } : { status: "fail", evidence: `“${value}” isn't on the page.` };
      case "hides":
        if (!value) return missing("the text that should be gone");
        return (await visible(session, value, 0)) ? { status: "fail", evidence: `“${value}” is still on the page.` } : { status: "pass", evidence: `“${value}” isn't on the page.` };
      case "url": {
        if (!value) return missing("part of the address");
        const url = session.page.url();
        return url.includes(value) ? { status: "pass", evidence: `The address is ${url}.` } : { status: "fail", evidence: `The address is ${url}, without “${value}”.` };
      }
      case "wallet": {
        const summaries = signs.map((r) => decodeWalletRequest(r).summary);
        if (summaries.length === 0) return { status: "fail", evidence: "Nothing was asked to sign on this path." };
        const match = value ? summaries.find((s) => s.toLowerCase().includes(value.toLowerCase())) : summaries.at(-1);
        return match ? { status: "pass", evidence: `The wallet was asked: ${match}.` } : { status: "fail", evidence: `The wallet was asked: ${summaries.at(-1)}, without “${value}”.` };
      }
      case "no-wallet":
        return signs.length === 0 ? { status: "pass", evidence: "Nothing was asked to sign on this path." } : { status: "fail", evidence: `The wallet was asked: ${decodeWalletRequest(signs.at(-1)!).summary}.` };
      case "tx":
        return await checkTx(session, signs);
      case "balance":
        if (!value) return missing("the number the page shows");
        return await checkBalance(session, value, assert.token);
    }
  } catch (e) {
    return { status: "error", evidence: `Couldn't make the check: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  }
}

const missing = (what: string): CheckResult => ({ status: "error", evidence: `The check didn't say ${what}.` });

async function visible(session: DrillSession, text: string, waitMs = SHOW_WAIT_MS): Promise<boolean> {
  const el = session.page.getByText(text).first();
  if (waitMs === 0) return el.isVisible().catch(() => false);
  return el.waitFor({ state: "visible", timeout: waitMs }).then(() => true, () => false);
}

async function checkTx(session: DrillSession, signs: WalletRequest[]): Promise<CheckResult> {
  const sent = signs.filter((r) => r.outcome === "approved" && typeof r.result === "string" && /^0x[0-9a-f]{64}$/i.test(r.result)).at(-1);
  if (!sent) return { status: "fail", evidence: "No transaction was sent on this path." };
  const client = session.chains.client(sent.chainId);
  const receipt = await client.waitForTransactionReceipt({ hash: sent.result as Hex, timeout: TX_WAIT_MS });
  return receipt.status === "success"
    ? { status: "pass", evidence: `Transaction ${short(sent.result as string)} was mined in block ${receipt.blockNumber}.` }
    : { status: "fail", evidence: `Transaction ${short(sent.result as string)} reverted in block ${receipt.blockNumber}.` };
}

/** The page's number has to be there and has to match the chain to the precision it is shown with. */
async function checkBalance(session: DrillSession, shown: string, token?: string): Promise<CheckResult> {
  const text = await session.page.evaluate(() => document.body.innerText);
  if (!text.includes(shown)) return { status: "fail", evidence: `“${shown}” isn't on the page.` };
  const chainId = session.wallet.chainId();
  const client = session.chains.client(chainId);
  const holder = session.wallet.address();
  let actual: string;
  if (token) {
    const [balance, decimals] = await Promise.all([
      client.readContract({ address: token as Hex, abi: erc20Abi, functionName: "balanceOf", args: [holder] }),
      client.readContract({ address: token as Hex, abi: erc20Abi, functionName: "decimals" }),
    ]);
    actual = formatUnits(balance, decimals);
  } else {
    actual = formatEther(await client.getBalance({ address: holder }));
  }
  return agrees(shown, actual) ? { status: "pass", evidence: `The page shows ${shown}; the chain says ${actual}.` } : { status: "fail", evidence: `The page shows ${shown}, but the chain says ${actual}.` };
}

/** "1,000.50" agrees with 1000.4999 or 1000.5001: the page rounds to the digits it shows. */
export function agrees(shown: string, actual: string): boolean {
  const clean = shown.replace(/[^0-9.]/g, "");
  const digits = clean.split(".")[1]?.length ?? 0;
  const step = 10 ** -digits;
  return Math.abs(Number(clean) - Number(actual)) < step;
}

const short = (hash: string) => `${hash.slice(0, 10)}…`;
