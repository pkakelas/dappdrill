/**
 * Everything one engine call needs: the target with chains and test accounts
 * resolved, running chains, the signing reviewer, the inbox and (lazily) the
 * model. One per look, make or run, closed at the end.
 */
import os from "node:os";
import path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { chainInfo, missingChainLine, nowIso, type ChainConfig, type DrillEvent, type DrillEventSink, type DrillTarget } from "@dappdrill/core";
import { createLlm } from "../agent/index.js";
import { openInbox } from "../inbox/index.js";
import { detectChains, startChains } from "../runtime.js";
import { createSigningReviewer } from "../signing/index.js";
import { fundOnFork } from "../wallet/controller.js";
import type { ChainController, Hex, Inbox, Llm, SigningReviewer } from "../types.js";

/** Empty-block cadence on forks: keeps the chain clock current and gives dApps confirmations. */
const FORK_HEARTBEAT_MS = 4_000;

export interface Env {
  /** The input target with chains (pinned fork blocks) and accounts filled in. */
  readonly target: DrillTarget;
  readonly chains: ChainController;
  readonly reviewer: SigningReviewer;
  readonly inbox?: Inbox;
  readonly headless: boolean;
  /** Wraps the caller's sink: cost events carry the running total of every model used here. */
  readonly sink: DrillEventSink;
  /** Looks around an app, and takes the second look at a test that fails (Opus by default). */
  thinkLlm(): Llm;
  /** Runs test steps and judges results (Sonnet by default). */
  fastLlm(): Llm;
  /** Does a test's model actions first (Haiku by default). */
  quickLlm(): Llm;
  costUsd(): number;
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>;
  /** Put forks the app added mid-run (other than `pinned`) back to how they were when added. */
  resetAddedChains(pinned: number[]): Promise<void>;
  close(): Promise<void>;
}

/** Used when the page makes no JSON-RPC calls we can see (apps behind their own backend). */
const FALLBACK_CHAIN = 1;

export async function openEnv(input: DrillTarget, sink: DrillEventSink, opts: { headless?: boolean }): Promise<Env> {
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
      configs = [...configs, ...learned.map(({ forkBlock: _, ...c }) => c)];
    }
    if (configs.length === 0) {
      await log("The page made no chain requests we could see; using an Ethereum fork for the wallet");
      configs = [fallbackChain()];
    }
  }

  // Forks the app added mid-run, as they were right after funding; see resetAddedChains.
  const baselines = new Map<number, string>();
  const chains = await startChains(configs, {
    liveKey: input.liveKey,
    allowMainnetLive: input.allowMainnetLive,
    heartbeatMs: FORK_HEARTBEAT_MS,
    log: (m) => void log(m),
    onAdded: async (c) => {
      if (c.mode === "fork") {
        await fundOnFork(chains, c.id, fundedAddresses(target), target.tokens);
        baselines.set(c.id, await chains.snapshot(c.id));
      }
      await log(`The app asked the wallet for ${c.name ?? `chain ${c.id}`} (chain ${c.id}); added it ${c.mode === "live" ? `as a live testnet via ${c.rpcUrl}` : `as a fork of ${c.rpcUrl}`}`);
      await wrapped({ type: "chains", chains: chains.configs() });
    },
    onMissing: (m) => log(missingChainLine(m), "warn"),
  });
  const live = chains.configs().filter((c) => c.mode === "live");
  const target: DrillTarget = {
    ...input,
    chains: chains.configs(),
    // Keys stay the same for the whole call so the setup and every test are the same user.
    accounts: freshAccounts(live.length > 0, input) ?? input.accounts ?? { A: generatePrivateKey(), B: generatePrivateKey() },
  };
  // Before anything is pinned, so going back to a snapshot never leaves the wallet empty.
  for (const c of target.chains) if (c.mode === "fork") await fundOnFork(chains, c.id, fundedAddresses(target), target.tokens);
  await wrapped({ type: "chains", chains: target.chains });
  for (const c of live) await log(liveChainLine(c, input.liveKey ? "key" : input.funding ? "funding" : "none"), "warn");

  return {
    target,
    chains,
    reviewer: createSigningReviewer({ etherscanApiKey: process.env.ETHERSCAN_API_KEY, cacheDir: process.env.DAPPDRILL_CACHE_DIR ?? path.join(os.homedir(), ".cache", "dappdrill") }),
    inbox: input.inbox ? await openInbox(input.inbox) : undefined,
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
    log,
    async resetAddedChains(pinned) {
      for (const [id, snap] of baselines) {
        if (pinned.includes(id)) continue;
        await chains.revert(id, snap);
        // Every later pin snapshots the chain itself.
        baselines.delete(id);
      }
    },
    close: () => chains.close(),
  };
}

/** Every address a session's wallet may use: accounts A and B, and the live key, which becomes A once a chain runs live. */
function fundedAddresses(target: DrillTarget): Hex[] {
  const keys = [target.accounts!.A, target.accounts!.B, target.liveKey].filter((k): k is string => !!k);
  return [...new Set(keys.map((k) => privateKeyToAccount(k as Hex).address))];
}

function fallbackChain(): ChainConfig {
  const info = chainInfo(FALLBACK_CHAIN)!;
  return { id: info.id, name: info.name, rpcUrl: info.rpcUrl, mode: "fork", fallback: true };
}

/** The chains without the Ethereum fallback once any chain of the app's own is known. */
export function withoutFallback(configs: ChainConfig[]): ChainConfig[] {
  return configs.some((c) => !c.fallback) ? configs.filter((c) => !c.fallback) : configs;
}

/**
 * On a live network with no funded key the saved test accounts would be the
 * same real accounts every run (faucets and sign-ups remember them), so each
 * call gets new ones. They can sign messages but hold nothing to pay gas with.
 */
export function freshAccounts(anyLive: boolean, input: Pick<DrillTarget, "liveKey">): DrillTarget["accounts"] | undefined {
  if (!anyLive || input.liveKey) return undefined;
  return { A: generatePrivateKey(), B: generatePrivateKey() };
}

export function liveChainLine(c: ChainConfig, funded: "key" | "funding" | "none"): string {
  const name = c.name ? `${c.name} (chain ${c.id})` : `Chain ${c.id}`;
  if (funded === "key") return `${name} can't be forked, so this run uses its live network with your funded key`;
  if (funded === "funding") return `${name} can't be forked, so this run uses its live network with a new account that gets test funds the way you described`;
  return `${name} can't be forked, and with no funded key or way to get test funds the wallet won't sign in there; add one under Settings → Chains`;
}
