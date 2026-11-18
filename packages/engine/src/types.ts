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
  MissingChain,
  RpcLogEntry,
  SigningReview,
  WalletExpectation,
  WalletProfileId,
  WalletRequest,
} from "@dappdrill/core";

export type Hex = `0x${string}`;

// ---------------------------------------------------------------- chains

/** A chain the app wants: what it passed to wallet_addEthereumChain, or the chain of typed data it asked to sign. */
export interface AddChainRequest {
  id: number;
  name?: string;
  /** RPCs the app offered (wallet_addEthereumChain). */
  rpcUrls: string[];
  /** Hosts the page called, tried after the offered RPCs: an app's own node often answers JSON-RPC too. */
  rpcHints?: string[];
}

export interface ChainController {
  /** Chains in use. */
  configs(): ChainConfig[];
  has(chainId: number): boolean;
  /** URL the wallet sends through. */
  rpcUrl(chainId: number): string;
  client(chainId: number): PublicClient;
  /** Forward a JSON-RPC call to the chain. */
  request(chainId: number, method: string, params: unknown[]): Promise<unknown>;

  /**
   * Take on a chain the app asked the wallet for mid-run. Throws with the reason
   * when it can't be reached, and remembers that chain in missing().
   */
  addFromApp(request: AddChainRequest): Promise<ChainConfig>;
  /** Chains the app asked for that addFromApp couldn't take on. */
  missing(): MissingChain[];

  close(): Promise<void>;
}

// ---------------------------------------------------------------- wallet

export interface WalletPolicy {
  /** Approve eth_requestAccounts / permissions without a test step. Default true. */
  autoConnect: boolean;
  /** Approve wallet_switchEthereumChain / addEthereumChain for chains we have. Default true. */
  autoSwitch: boolean;
  /** Answer the first wallet_switchEthereumChain with 4902 (unknown chain). */
  unknownChainOnce: boolean;
  /** Approve every signing request immediately. */
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
  ui: { buttonLabel?: string; pageUrl?: string; screenshot?: string };
  /** The recorded wallet step the request answers, when it comes from a replay. */
  script?: {
    id: string;
    name: string;
    stepIndex: number;
    expectation?: WalletExpectation;
    params: Record<string, string>;
  };
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
  readonly model: string;
  /** Tool loop until the model stops calling tools or maxTurns is hit. */
  runAgent(opts: {
    system: string;
    prompt: string;
    images?: ImageInput[];
    tools: AgentTool[];
    maxTurns: number;
    signal?: AbortSignal;
    onText?: (text: string) => void;
  }): Promise<{ text: string; stopReason?: "end_turn" | "max_turns" }>;
  /** One call that returns JSON validated against `schema`. A reply that doesn't fit is asked for once more. */
  structured<T>(opts: { system: string; prompt: string; images?: ImageInput[]; schema: ZodType<T>; name: string; signal?: AbortSignal }): Promise<T>;
  /** Estimated spend so far, USD. */
  costUsd(): number;
}

// ---------------------------------------------------------------- test inbox

/** Disposable inbox for email-code logins (embedded wallets). Implemented in inbox/. */
export interface Inbox {
  readonly address: string;
  /** Waits for an email that arrived after `sinceMs` and returns the login code (or magic link) in it. */
  latestCode(opts: { sinceMs: number; timeoutMs: number }): Promise<string>;
}
