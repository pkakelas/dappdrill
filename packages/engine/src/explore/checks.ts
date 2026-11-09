/**
 * Deciding a check. The explorer says what should be true; this looks at the page, the wallet and
 * the chain and says whether it is. There is no way to pass a check by saying so, and a check
 * that can't be made comes back as "error", not as a pass.
 */
import { erc20Abi, formatEther, formatUnits } from "viem";
import { chainName, shortAddress, type CheckAssert, type ExploreCheckStatus, type WalletRequest } from "@dappdrill/core";
import { decodeWalletRequest } from "../agent/wallet-decode.js";
import { settle } from "../agent/tools.js";
import type { DrillSession, Hex } from "../types.js";
import { carried, tokensNamed, type NamedToken } from "./carried.js";
import { addsUp, asRead, brokenValues, loosely, numberOnPage, shownNumber } from "./display.js";
import { referencePrices } from "./prices.js";

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
        if (match) return { status: "pass", evidence: `The wallet was asked: ${match}.` };
        // The summary shortens addresses and leaves undecoded calldata out; the request itself has them.
        const hex = /^(0x)?[0-9a-f]{8,}$/i.test(value!) ? value!.toLowerCase().replace(/^0x/, "") : undefined;
        const held = hex === undefined ? -1 : signs.findIndex((r) => (JSON.stringify(r.params) ?? "").toLowerCase().includes(hex));
        if (held >= 0) return { status: "pass", evidence: `The wallet was asked: ${summaries[held]}, with “${value}” in its data.` };
        // For an address that should have been there (a recipient, a spender), the ones that are.
        const names = hex?.length === 40 ? addressesIn(signs.at(-1)!, session.wallet.address()) : "";
        return { status: "fail", evidence: `The wallet was asked: ${summaries.at(-1)}, without “${value}”.${names}` };
      }
      case "wallet-amount":
        if (!value) return missing("the amount the page shows");
        if (!assert.token) return missing("which token the amount is of");
        return await checkAmount(session, signs, value, assert.token);
      case "no-wallet":
        return signs.length === 0 ? { status: "pass", evidence: "Nothing was asked to sign on this path." } : { status: "fail", evidence: `The wallet was asked: ${decodeWalletRequest(signs.at(-1)!).summary}.` };
      case "tx":
        return await checkTx(session, signs);
      case "balance":
        if (!value) return missing("the number the page shows");
        return await checkBalance(session, value, assert.token);
      case "price":
        if (!value) return missing("the price the page shows");
        if (!assert.token) return missing("which asset the price is of");
        return await checkPrice(session, value, assert.token);
      case "adds-up": {
        if (!value) return missing("the sum");
        const r = addsUp(value, await pageText(session));
        if (r.error) return { status: "error", evidence: r.error };
        return r.ok ? { status: "pass", evidence: `${value.trim()} holds for the numbers on the page.` } : { status: "fail", evidence: `The left side comes to ${trim(r.left!)}, but the page shows ${trim(r.right!)}.` };
      }
      case "well-formed": {
        const broken = brokenValues(await pageText(session));
        return broken.length
          ? { status: "fail", evidence: `The page shows ${broken.slice(0, 3).map((b) => `${b.what} in “${b.line}”`).join("; ")}.` }
          : { status: "pass", evidence: "No NaN, undefined or other broken value on the page." };
      }
    }
  } catch (e) {
    return { status: "error", evidence: `Couldn't make the check: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}` };
  }
}

const missing = (what: string): CheckResult => ({ status: "error", evidence: `The check didn't say ${what}.` });

/** In one element as written, or across elements and fields the way a person reads them ("Fee" above "$0.04", "1,000" for 1000). */
async function visible(session: DrillSession, text: string, waitMs = SHOW_WAIT_MS): Promise<boolean> {
  const el = session.page.getByText(text).first();
  const inOne = await (waitMs === 0 ? el.isVisible().catch(() => false) : el.waitFor({ state: "visible", timeout: waitMs }).then(() => true, () => false));
  return inOne || loosely(await pageText(session)).includes(loosely(text));
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

/**
 * The page's number has to match the chain to the precision it is shown with. A number the page
 * doesn't show says nothing about the app: there is nothing to compare.
 */
async function checkBalance(session: DrillSession, shown: string, token?: string): Promise<CheckResult> {
  if (!loosely(await pageText(session)).includes(loosely(shown))) return { status: "error", evidence: `“${shown}” isn't on the page, so there is nothing to compare with the chain. Give the number as the page shows it.` };
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

/** How far the amount in a request may sit from the one shown: slippage on what is received, a margin on what is paid. */
const AMOUNT_TOLERANCE = 0.05;

/**
 * The page quotes an amount of a token and the wallet is asked to sign: a request has to carry
 * that amount, in that token's own units. Which word of the request it is doesn't matter, so this
 * needs no ABI. It fails only when a request names the token and has no such amount; a request
 * that doesn't name it may count in something else (a vault's shares), and then the check couldn't be made.
 */
async function checkAmount(session: DrillSession, signs: WalletRequest[], shown: string, token: string): Promise<CheckResult> {
  const want = shownNumber(shown);
  if (want === undefined || want <= 0) return { status: "error", evidence: `“${shown}” isn't an amount.` };
  if (!loosely(await pageText(session)).includes(loosely(shown))) return { status: "error", evidence: `“${shown}” isn't on the page, so there is nothing to compare the request with. Give the number as the page shows it.` };
  const requests = signs.map((r) => ({ r, has: carried(r) })).filter(({ has }) => has.amounts.length > 0).reverse();
  if (!signs.length) return { status: "fail", evidence: "Nothing was asked to sign on this path." };
  const asked = (r: WalletRequest) => `The wallet was asked: ${decodeWalletRequest(r).summary}`;
  if (!requests.length) return { status: "fail", evidence: `${asked(signs.at(-1)!)}, which carries no amount.` };

  const { named, others } = await tokensNamed(session, token, requests[0]!.r.chainId, requests.flatMap(({ has }) => has.addresses));
  if (!named.length) {
    // What it does name, and whether the page's number is there in those units: the reader can tell what we can't.
    const all = requests.flatMap(({ has }) => has.amounts);
    const inIts = (t: NamedToken) => all.map((a) => Number(a) / 10 ** t.decimals).find((n) => Math.abs(n - want) <= want * AMOUNT_TOLERANCE);
    const names = others.map((t) => (inIts(t) === undefined ? where(t) : `${where(t)}, and carries ${trim(inIts(t)!)} of it`));
    return { status: "error", evidence: `Couldn't tell which amount in the request is ${token}: it names ${names.length ? names.join("; ") : "no token we could read"}. ${asked(requests[0]!.r)}.` };
  }
  const page = shown.toLowerCase().includes(named[0]!.symbol.toLowerCase()) ? shown : `${shown} ${named[0]!.symbol}`;

  let missed: { r: WalletRequest; token: NamedToken; near?: number } | undefined;
  for (const { r, has } of requests) {
    for (const t of named) {
      const inUnits = has.amounts.map((a) => Number(a) / 10 ** t.decimals);
      const nearest = (within: number) => inUnits.filter((n) => Math.abs(n - want) <= want * within).sort((a, b) => Math.abs(a - want) - Math.abs(b - want))[0];
      const found = nearest(AMOUNT_TOLERANCE);
      if (found !== undefined) return { status: "pass", evidence: `The page shows ${page}; the request carries ${trim(found)} ${where(t)}.` };
      if (!t.address || has.addresses.includes(t.address)) missed ??= { r, token: t, near: nearest(0.9) };
    }
  }
  if (!missed) return { status: "error", evidence: `No request names ${where(named[0]!)}, and none carries ${page} in its units, so the amount may be counted in something else (shares, say). ${asked(requests[0]!.r)}.` };
  const near = missed.near === undefined ? "" : `; the nearest amount in it is ${trim(missed.near)}`;
  return { status: "fail", evidence: `The page shows ${page}, but nothing in the request for ${where(missed.token)} is within ${AMOUNT_TOLERANCE * 100}% of it${near}. ${asked(missed.r)}.` };
}

const where = (t: NamedToken) => (t.address ? `${t.symbol} (${shortAddress(t.address)} on ${chainName(t.chainId)}${t.confirmed ? "" : ", read from the real chain, not confirmed on the fork"})` : `${t.symbol} (${chainName(t.chainId)}'s own coin)`);

function addressesIn(r: WalletRequest, wallet: string): string {
  const all = carried(r).addresses;
  if (!all.length) return "";
  const shown = all.slice(0, 8).map((a) => (a === wallet.toLowerCase() ? `${shortAddress(a)} (the test wallet)` : shortAddress(a)));
  return ` The addresses in it: ${shown.join(", ")}${all.length > 8 ? " and more" : ""}.`;
}

/** How far a shown price may sit from the market: perps, stale closes and spreads all move it a little. */
const PRICE_TOLERANCE = 0.03;

async function checkPrice(session: DrillSession, claimed: string, asset: string): Promise<CheckResult> {
  // A live price has often ticked since it was read, so the page's own number nearest the one named is what gets checked.
  const shown = numberOnPage(await pageText(session), claimed);
  if (!shown) return { status: "error", evidence: `“${claimed}” isn't on the page, and nothing close to it is, so there is nothing to compare with the market.` };
  const away = (p: { usd: number }) => Math.abs(shown.value - p.usd) / p.usd;
  // A ticker can name a coin and a stock (ETH is both): the one the page agrees with, else the coin.
  const found = await referencePrices(asset, session.wallet.chainId());
  const market = found.find((p) => away(p) <= PRICE_TOLERANCE) ?? found[0];
  if (!market) return { status: "error", evidence: `No market price for ${asset} to compare with.` };
  const off = away(market);
  const said = `The page shows ${shown.text}; ${market.source} says ${trim(market.usd)} (not confirmed on the fork)`;
  return off <= PRICE_TOLERANCE ? { status: "pass", evidence: `${said}.` } : { status: "fail", evidence: `${said}, ${(off * 100).toFixed(1)}% apart.` };
}

/** What a user can read: the body's text (an open dialog's is part of it) and what the fields hold. */
async function pageText(session: DrillSession): Promise<string> {
  const text = await session.page.evaluate(() => {
    const fields = [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter((f) => f.value && f.type !== "password" && f.type !== "hidden" && f.checkVisibility());
    return [document.body.innerText, ...fields.map((f) => f.value)].join("\n");
  });
  return asRead(text);
}
const trim = (n: number) => String(Number(n.toPrecision(8)));

/** "1,000.50" agrees with 1000.4999 or 1000.5001: the page rounds to the digits it shows. */
export function agrees(shown: string, actual: string): boolean {
  const clean = shown.replace(/[^0-9.]/g, "");
  const digits = clean.split(".")[1]?.length ?? 0;
  const step = 10 ** -digits;
  return Math.abs(Number(clean) - Number(actual)) < step;
}

const short = (hash: string) => `${hash.slice(0, 10)}…`;
