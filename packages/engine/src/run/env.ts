/**
 * Everything one engine call needs: the target with chains and test accounts
 * resolved, the chains, the signing reviewer, the inbox and (lazily) the
 * models. One per look, make, run or repair, closed at the end. A run never asks for a model.
 */
import os from "node:os";
import path from "node:path";
import { concat, encodeFunctionData, erc20Abi, keccak256, parseEther, parseUnits, stringToHex, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainInfo, fundText, missingChainLine, nowIso, shortAddress, type ChainConfig, type DrillEvent, type DrillEventSink, type DrillTarget, type Fund } from "@dappdrill/core";
import { createLlm } from "../agent/index.js";
import { openInbox } from "../inbox/index.js";
import { detectChains, startChains } from "../runtime.js";
import { createSigningReviewer } from "../signing/index.js";
import { prepareTransaction, sendPrepared } from "../wallet/signer.js";
import type { ChainController, Hex, Inbox, Llm, SigningReviewer } from "../types.js";

export interface Env {
  /** The input target with chains and accounts filled in. */
  readonly target: DrillTarget;
  readonly chains: ChainController;
  readonly reviewer: SigningReviewer;
  readonly inbox?: Inbox;
  readonly headless: boolean;
  /** Wraps the caller's sink: cost events carry the running total of every model used here. */
  readonly sink: DrillEventSink;
  /** Looks around an app, and takes the second look at a test that fails (Opus by default). */
  thinkLlm(): Llm;
  /** Writes and repairs tests, writes checks as code, and takes over an action the quick model couldn't do (Sonnet by default). */
  fastLlm(): Llm;
  /** Does an action that has no code first (Haiku by default). */
  quickLlm(): Llm;
  costUsd(): number;
  close(): Promise<void>;
}

export type Accounts = NonNullable<DrillTarget["accounts"]>;

/** Used when the page makes no JSON-RPC calls we can see (apps behind their own backend). */
const FALLBACK_CHAIN = 1;
/** How long a payment to a new account gets to be mined. */
const FUNDED_WITHIN_MS = 120_000;

export async function openEnv(input: DrillTarget, sink: DrillEventSink, opts: { headless?: boolean; signal?: AbortSignal; fundChains?: number[] }): Promise<Env> {
  const stopIfAborted = () => opts.signal?.throwIfAborted();
  const headless = opts.headless ?? true;
  const llms: Llm[] = [];
  let think: Llm | undefined;
  let fast: Llm | undefined;
  let quick: Llm | undefined;
  const costUsd = () => llms.reduce((sum, l) => sum + l.costUsd(), 0);

  const wrapped: DrillEventSink = (event: DrillEvent) => sink(event.type === "cost" ? { type: "cost", usd: Math.round(costUsd() * 1000) / 1000 } : event);
  const log = async (message: string, level: "info" | "warn" | "error" = "info") => {
    await wrapped({ type: "log", level, message, at: nowIso() });
  };

  let configs = withoutFallback(input.chains);
  if (configs.length === 0) {
    await log("Detecting which chains the app uses");
    configs = await detectChains(input.url, { headless, log: (m) => void log(m) });
    const learned = input.learnedChains.filter((l) => !configs.some((c) => c.id === l.id));
    if (learned.length) {
      await log(`Earlier runs saw the app ask for ${learned.map((c) => c.name ?? `chain ${c.id}`).join(", ")}; starting with ${learned.length === 1 ? "it" : "them"} too`);
      configs = [...configs, ...learned];
    }
    if (configs.length === 0) {
      await log("The page made no chain requests we could see; using Ethereum for the wallet");
      configs = [fallbackChain()];
    }
  }
  // A chain new accounts are paid on is needed whether or not the page showed it.
  for (const id of [...input.fund.map((f) => f.chainId), ...(opts.fundChains ?? [])]) {
    const info = chainInfo(id);
    if (info && !configs.some((c) => c.id === id)) configs = [...configs, { id: info.id, name: info.name, rpcUrl: info.rpcUrl }];
  }

  stopIfAborted();
  const chains = startChains(configs, {
    log: (m) => void log(m),
    onAdded: async (c) => {
      await log(`The app asked the wallet for ${c.name ?? `chain ${c.id}`} (chain ${c.id}); added it via ${c.rpcUrl}`);
      await wrapped({ type: "chains", chains: chains.configs() });
    },
    onMissing: (m) => log(missingChainLine(m), "warn"),
  });
  // Keys stay the same for the whole call on a kept account, so the setup and every test are the same user.
  const target: DrillTarget = { ...input, chains: chains.configs(), accounts: accountsFor(input) };
  await wrapped({ type: "chains", chains: target.chains });
  if (input.account === "new" && input.inbox) await log("Every test gets a new wallet, but the email login is one inbox: the app sees the same user each time. Use a kept account for an app that signs in by email.", "warn");
  const inbox = input.inbox ? await openInbox(input.inbox) : undefined;
  stopIfAborted();

  return {
    target,
    chains,
    reviewer: createSigningReviewer({ etherscanApiKey: process.env.ETHERSCAN_API_KEY, cacheDir: process.env.DAPPDRILL_CACHE_DIR ?? path.join(os.homedir(), ".cache", "dappdrill") }),
    inbox,
    headless,
    sink: wrapped,
    thinkLlm() {
      if (!think) llms.push((think = createLlm()));
      return think;
    },
    fastLlm() {
      if (!fast) llms.push((fast = createLlm({ role: "fast" })));
      return fast;
    },
    quickLlm() {
      if (!quick) llms.push((quick = createLlm({ role: "quick" })));
      return quick;
    },
    costUsd,
    close: () => chains.close(),
  };
}

/** What a run's new accounts are made from when a key pays them: that key, and an id of the run's own. */
export interface AccountSeed {
  fundedKey: string;
  runId: string;
}

/**
 * Keys for a start. With a seed they are the same every time for the same key, run id and `n`, so whoever
 * holds the funding key can collect what a test left behind even after the run is gone (`pnpm collect`).
 * With none they are keys nobody can make again.
 */
export function newAccounts(seed?: AccountSeed, n = 0): Accounts {
  if (!seed) return { A: generatePrivateKey(), B: generatePrivateKey() };
  const key = (which: "A" | "B") => keccak256(concat([seed.fundedKey as Hex, stringToHex(`dappdrill:${seed.runId}:${n}:${which}`)]));
  return { A: key("A"), B: key("B") };
}

/**
 * The accounts a call starts with. Kept: the owner's funded key as account A when there is one, else the
 * saved accounts, the same every run. New: keys nobody has seen, whatever was saved.
 */
export function accountsFor(input: Pick<DrillTarget, "account" | "accounts" | "fundedKey">): Accounts {
  const made = newAccounts();
  if (input.account !== "kept") return made;
  return { A: input.fundedKey ?? input.accounts?.A ?? made.A, B: input.accounts?.B ?? made.B };
}

/**
 * The same chains, models, cost, reviewer and sink with accounts of its own: what one test on new accounts
 * runs in. Closing it closes nothing, since the env it came from still holds everything.
 */
export function withAccounts(env: Env, accounts: Accounts): Env {
  return { ...env, target: { ...env.target, accounts }, close: async () => {} };
}

/** The payments going out from each funded key, so the next waits for the one before it. */
const paying = new Map<string, Promise<void>>();

/**
 * Sends a new account what the target lists under `fund`, from the funded key: the chain's coin, or an
 * ERC-20 by `transfer`. Only account A is paid. One account at a time for each key, so two starts never
 * take the same nonce, and each payment is waited for until it is mined. With no key or nothing listed
 * the account stays empty. Throws with a sentence for the owner when a payment couldn't be made.
 */
export function fundAccount(chains: ChainController, target: { fundedKey?: string; fund: Fund[] }, to: Hex): Promise<void> {
  if (!target.fundedKey || !target.fund.length) return Promise.resolve();
  const payer = privateKeyToAccount(target.fundedKey as Hex);
  const turn = (paying.get(payer.address) ?? Promise.resolve()).catch(() => {}).then(() => pay(chains, payer, target.fund, to));
  paying.set(payer.address, turn);
  return turn;
}

async function pay(chains: ChainController, payer: PrivateKeyAccount, fund: Fund[], to: Hex): Promise<void> {
  for (const f of fund) {
    const what = fundText(f);
    try {
      if (!chains.has(f.chainId)) throw new Error("that chain isn't one of the app's chains");
      const client = chains.client(f.chainId);
      const token = f.token as Hex | undefined;
      const transfer = async (token: Hex) => {
        const decimals = await client.readContract({ address: token, abi: erc20Abi, functionName: "decimals" });
        return encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, parseUnits(f.amount, decimals)] });
      };
      const tx = token ? { to: token, data: await transfer(token) } : { to, value: toHex(parseEther(f.amount)) };
      const hash = await sendPrepared(chains, payer, await prepareTransaction(chains, f.chainId, payer.address, tx));
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: FUNDED_WITHIN_MS, pollingInterval: 1_000 });
      if (receipt.status !== "success") throw new Error("the transaction reverted");
    } catch (e) {
      // A node's own words (too little to pay with, a revert) sit under the wallet's wrapping of them.
      const said = e as { data?: { message?: string }; shortMessage?: string };
      const why = (said.data?.message ?? said.shortMessage ?? (e instanceof Error ? e.message : String(e))).split("\n")[0]!.slice(0, 200);
      throw new Error(`The key that funds the test accounts (${shortAddress(payer.address)}) couldn't send ${what}: ${why}`);
    }
  }
}

function fallbackChain(): ChainConfig {
  const info = chainInfo(FALLBACK_CHAIN)!;
  return { id: info.id, name: info.name, rpcUrl: info.rpcUrl, fallback: true };
}

/** The chains without the Ethereum fallback once any chain of the app's own is known. */
export function withoutFallback(configs: ChainConfig[]): ChainConfig[] {
  return configs.some((c) => !c.fallback) ? configs.filter((c) => !c.fallback) : configs;
}
