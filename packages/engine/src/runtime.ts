/**
 * The engine runtime: chains, wallet, browser session, deterministic replay
 * and the edge-case matrix. api.ts composes these with the agent and the
 * signing reviewer.
 */
export { startChains, type StartChainsOptions } from "./chain/controller.js";
export { detectChains, type DetectChainsOptions } from "./chain/detect.js";
export { createSession, type SessionOptions, type EngineSession } from "./browser/session.js";
export { Wallet, type WalletOptions, type PendingSignRequest } from "./wallet/controller.js";
export { walletInitScript, type InjectConfig } from "./wallet/inject.js";
export { replayFlow, type ReplayFlowOptions, type ReplayFlowResult, type ReplayHooks } from "./replay/replay.js";
export { runEdgeCases, type RunEdgeCasesOptions, type RunEdgeCasesResult } from "./replay/edge-cases.js";
