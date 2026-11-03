/**
 * Everything one engine call needs: the target with chains and test accounts
 * resolved, running chains, the signing reviewer, the inbox and (lazily) the
 * model. One per scan / replay / describe / repair, closed at the end.
 */
import os from "node:os";
import path from "node:path";
import { generatePrivateKey } from "viem/accounts";
import { chainInfo, nowIso, type ChainConfig, type DrillEvent, type DrillEventSink, type DrillTarget } from "@dappdrill/core";
import { createLlm, createRecoveryJudge } from "../agent/index.js";
import { openInbox } from "../inbox/index.js";
import { detectChains, startChains } from "../runtime.js";
import { createSigningReviewer } from "../signing/index.js";
import type { ChainController, Inbox, Llm, RecoveryJudge, SigningReviewer } from "../types.js";

export interface Env {
  /** The input target with chains (pinned fork blocks) and accounts filled in. */
  readonly target: DrillTarget;
  readonly chains: ChainController;
  readonly reviewer: SigningReviewer;
  readonly inbox?: Inbox;
  readonly headless: boolean;
  /** Wraps the caller's sink: cost events carry the running total of every model used here. */
  readonly sink: DrillEventSink;
  llm(): Llm;
  judge(): RecoveryJudge;
  costUsd(): number;
  log(message: string, level?: "info" | "warn" | "error"): Promise<void>;
  close(): Promise<void>;
}

/** Used when the page makes no JSON-RPC calls we can see (apps behind their own backend). */
const FALLBACK_CHAIN = 1;

export async function openEnv(input: DrillTarget, sink: DrillEventSink, opts: { headless?: boolean }): Promise<Env> {
  const headless = opts.headless ?? true;
  const llms: Llm[] = [];
  let llm: Llm | undefined;
  let judge: RecoveryJudge | undefined;
  const costUsd = () => llms.reduce((sum, l) => sum + l.costUsd(), 0);

  const wrapped: DrillEventSink = (event: DrillEvent) =>
    sink(event.type === "cost" ? { type: "cost", usd: Math.round(costUsd() * 1000) / 1000 } : event);
  const log = async (message: string, level: "info" | "warn" | "error" = "info") => {
    await wrapped({ type: "log", level, message, at: nowIso() });
  };

  let configs = input.chains;
  if (configs.length === 0) {
    await log("Detecting which chains the app uses");
    configs = await detectChains(input.url, { headless, log: (m) => void log(m) });
    if (configs.length === 0) {
      await log("The page made no chain requests we could see; using an Ethereum fork for the wallet");
      configs = [fallbackChain()];
    }
  }

  const chains = await startChains(configs, {
    liveKey: input.liveKey,
    allowMainnetLive: input.allowMainnetLive,
    log: (m) => void log(m),
  });
  const target: DrillTarget = {
    ...input,
    chains: chains.configs(),
    // Keys stay the same for the whole call so setup flows, edge cases and approvals line up.
    accounts: input.accounts ?? { A: generatePrivateKey(), B: generatePrivateKey() },
  };
  await wrapped({ type: "chains", chains: target.chains });
  for (const c of target.chains) {
    if (c.mode === "live") await log(`${c.name ?? `Chain ${c.id}`} can't be forked: using the live testnet${input.liveKey ? " with your funded key" : " (read-only, no funded key)"}`, "warn");
  }

  return {
    target,
    chains,
    reviewer: createSigningReviewer({ etherscanApiKey: process.env.ETHERSCAN_API_KEY, cacheDir: process.env.DAPPDRILL_CACHE_DIR ?? path.join(os.homedir(), ".cache", "dappdrill") }),
    inbox: input.inbox ? await openInbox(input.inbox) : undefined,
    headless,
    sink: wrapped,
    llm() {
      if (!llm) llms.push((llm = createLlm()));
      return llm;
    },
    judge() {
      if (!judge) {
        const cheap = createLlm({ effort: "low" });
        llms.push(cheap);
        judge = createRecoveryJudge(cheap);
      }
      return judge;
    },
    costUsd,
    log,
    close: () => chains.close(),
  };
}

function fallbackChain(): ChainConfig {
  const info = chainInfo(FALLBACK_CHAIN)!;
  return { id: info.id, name: info.name, rpcUrl: info.rpcUrl, mode: "fork" };
}
