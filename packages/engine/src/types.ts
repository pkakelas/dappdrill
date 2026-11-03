/**
 * Seams between the engine's modules. Each module (runtime, agent, signing)
 * implements its side against these interfaces so they can be built and
 * tested independently.
 */
import type { BrowserContext, Page } from "playwright";
import type { PublicClient } from "viem";
import type { ZodType } from "zod";
import type {
  ChainConfig,
  ConsoleEntry,
  DrillEventSink,
  DrillTarget,
  RpcLogEntry,
  SigningReview,
  WalletExpectation,
  WalletProfileId,
  WalletRequest,
} from "@dappdrill/core";

export type Hex = `0x${string}`;

// ---------------------------------------------------------------- chains

export interface ChainController {
  /** Chains in use, with pinned fork blocks filled in. */
  configs(): ChainConfig[];
  has(chainId: number): boolean;
  mode(chainId: number): "fork" | "live";
  /** URL the wallet and the page's RPC traffic are routed to (local Anvil for forks). */
  rpcUrl(chainId: number): string;
  client(chainId: number): PublicClient;
  /** Forward a JSON-RPC call to the chain, applying current faults (latency/failures). */
  request(chainId: number, method: string, params: unknown[]): Promise<unknown>;

  // Fork-only controls. Throw in live mode.
  setBalance(chainId: number, address: Hex, wei: bigint): Promise<void>;
  /** Give `address` an ERC-20 balance by writing the token's storage. */
  dealErc20(chainId: number, token: Hex, address: Hex, amount: bigint): Promise<void>;
  setAutomine(chainId: number, on: boolean): Promise<void>;
  mine(chainId: number): Promise<void>;
  snapshot(chainId: number): Promise<string>;
  revert(chainId: number, snapshotId: string): Promise<void>;
  impersonate(chainId: number, address: Hex): Promise<void>;

  /** Faults applied to every RPC call (page and wallet) until cleared. */
  setFaults(faults: { latencyMs?: number; failureRate?: number }): void;

  close(): Promise<void>;
}

// ---------------------------------------------------------------- wallet

export interface WalletPolicy {
  /** Approve eth_requestAccounts / permissions without a flow step. Default true. */
  autoConnect: boolean;
  /** Approve wallet_switchEthereumChain / addEthereumChain for chains we have. Default true. */
  autoSwitch: boolean;
  /** Answer the first wallet_switchEthereumChain with 4902 (unknown chain). */
  unknownChainOnce: boolean;
  /** Approve every signing request immediately (used while exploring when the agent opts in). */
  autoSign: boolean;
}

export interface PendingSign {
  request: WalletRequest;
  /** Label of the last element the user clicked before the request: "the button said". */
  buttonLabel?: string;
  pageUrl: string;
}

export interface WalletController {
  readonly profile: WalletProfileId;
  readonly accounts: { A: Hex; B: Hex };
  /** Currently selected account. */
  address(): Hex;
  chainId(): number;
  policy(): WalletPolicy;
  setPolicy(patch: Partial<WalletPolicy>): void;
  /** Every request seen in this session, in order. */
  requests(): WalletRequest[];
  /** Resolves with the next signing request that hasn't been answered yet. */
  nextSign(timeoutMs: number): Promise<PendingSign>;
  /** Sign/send it and answer the dApp. Returns the result (tx hash or signature). */
  approve(requestId: string): Promise<unknown>;
  /** Answer the dApp with an EIP-1193 error (4001 user rejected by default). */
  reject(requestId: string, code?: number, message?: string): Promise<void>;
  /** Select account A or B and emit accountsChanged. */
  switchAccount(to: "A" | "B"): Promise<void>;
  /** Change network from the wallet side and emit chainChanged. */
  switchChain(chainId: number): Promise<void>;
  /** Called for every request as it arrives. */
  onRequest(cb: (req: WalletRequest) => void): () => void;
}

// ---------------------------------------------------------------- session

export interface DrillSession {
  readonly page: Page;
  readonly context: BrowserContext;
  readonly wallet: WalletController;
  readonly chains: ChainController;
  readonly target: DrillTarget;
  readonly artifactsDir: string;
  readonly console: ConsoleEntry[];
  readonly rpc: RpcLogEntry[];
  emit: DrillEventSink;
  /** Saves a PNG into the artifacts dir and returns its path relative to it. */
  screenshot(name: string): Promise<string>;
  /** Accessible label of the last element clicked (by the agent or a replay). */
  lastClickedLabel(): string | undefined;
  close(): Promise<{ video?: string; trace?: string }>;
}

// ---------------------------------------------------------------- signing

export interface SigningInput {
  request: WalletRequest;
  chains: ChainController;
  ui: { buttonLabel?: string; pageUrl?: string; screenshot?: string; context?: string };
  flow?: {
    id: string;
    name: string;
    stepIndex: number;
    expectation?: WalletExpectation;
    params: Record<string, string>;
  };
  /** Accepted reviews from earlier runs, keyed by fingerprint. */
  baselines: Record<string, SigningReview>;
  /** Used for the "matches the button" comparison. Optional so the reviewer runs without a model. */
  llm?: Llm;
  /** Absolute path of the artifacts dir (to read the screenshot for the UI check). */
  artifactsDir?: string;
}

export interface SigningReviewer {
  review(input: SigningInput): Promise<SigningReview>;
}

// ---------------------------------------------------------------- llm

export interface ImageInput {
  /** base64 without data: prefix */
  data: string;
  mediaType: "image/png" | "image/jpeg";
}

export interface AgentToolResult {
  text: string;
  image?: ImageInput;
}

export interface AgentTool<I = any> {
  name: string;
  description: string;
  schema: ZodType<I>;
  handler(input: I): Promise<string | AgentToolResult>;
}

export interface Llm {
  /** Which backend is active: an API key, or the local Claude Code login via the Agent SDK. */
  readonly backend: "api" | "agent-sdk";
  /** Tool loop until the model stops calling tools or maxTurns is hit. */
  runAgent(opts: {
    system: string;
    prompt: string;
    images?: ImageInput[];
    tools: AgentTool[];
    maxTurns: number;
    signal?: AbortSignal;
    onText?: (text: string) => void;
  }): Promise<{ text: string }>;
  /** One call that returns JSON validated against `schema`. */
  structured<T>(opts: { system: string; prompt: string; images?: ImageInput[]; schema: ZodType<T>; name: string }): Promise<T>;
  /** Estimated spend so far, USD. */
  costUsd(): number;
}

// ---------------------------------------------------------------- edge-case judging

/**
 * Optional model check used after an edge case: did the app recover and tell
 * the user what happened? Deterministic checks run first; this only adds a
 * plain-language verdict. Implemented in agent/, consumed by replay/.
 */
export interface RecoveryJudge {
  judge(input: {
    edgeCase: string;
    /** What a good app would do, e.g. "Show that the request was rejected and let the user try again". */
    expected: string;
    screenshot: ImageInput;
    pageText: string;
  }): Promise<{ ok: boolean; explanation: string }>;
}
