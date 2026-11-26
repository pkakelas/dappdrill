/**
 * Node side of the injected wallet. Answers every request the page-side
 * provider forwards, following the WalletPolicy for interactive requests and
 * signing with viem local accounts. Mirrors MetaMask's error codes and
 * messages so dApps take the same code paths they would with a real wallet.
 */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { recoverMessageAddress, isHex } from "viem";
import { KNOWN_CHAINS, SIGN_METHODS, newId, nowIso, type WalletProfileId, type WalletRequest } from "@dappdrill/core";
import type { ChainController, Hex, PendingSign, WalletController, WalletPolicy } from "../types.js";
import { JsonRpcError, hexToNumber, rpcCall, toHex, toRpcError } from "../chain/rpc.js";
import { WalletErrors } from "./errors.js";
import type { BridgeRequest, BridgeResponse } from "./inject.js";
import { nodeError, prepareTransaction, sendPrepared, signEthSign, signPersonal, signTypedData, typedDataChainId, type PreparedTx, type TxRequest } from "./signer.js";

export interface WalletOptions {
  profile: WalletProfileId;
  chains: ChainController;
  /** Hex private keys. Generated when missing. */
  accounts?: { A: string; B: string };
  startChainId: number;
  /** The site was connected in an earlier session that this one carries on from. */
  connected?: boolean;
  policy?: Partial<WalletPolicy>;
  log?: (message: string) => void;
}

/** What the session tells the wallet about the page when a request arrives. */
export interface RequestContext {
  pageUrl: string;
  buttonLabel?: string;
  /** Number of clicks seen so far; two sign requests with the same value came from one click. */
  clickSeq: number;
  /** The page that asked: the same object across its navigations (see pageGone). */
  page?: object;
}

export interface PendingSignRequest extends PendingSign {
  clickSeq: number;
  /** Which injected wallet the dApp used (matters in two-wallets mode). */
  wallet: WalletProfileId;
}

interface Pending {
  req: WalletRequest;
  ctx: RequestContext;
  wallet: WalletProfileId;
  settle: (res: BridgeResponse) => void;
  run: () => Promise<BridgeResponse>;
}

const DEFAULT_POLICY: WalletPolicy = { autoConnect: true, autoSwitch: true, unknownChainOnce: false, autoSign: false };
const PASSTHROUGH_CAP = 40;

/** A wallet wraps what the node said (a revert, a nonce) as "Internal JSON-RPC error" with the reason in data; keep the reason. */
export function errorLine(error: { code: number; message: string; data?: unknown }): string {
  const inner = (error.data as { message?: unknown } | undefined)?.message;
  const reason = typeof inner === "string" && inner && !error.message.includes(inner) ? `: ${inner.slice(0, 300)}` : "";
  return `${error.code} ${error.message.replace(/\.$/, reason ? "" : ".")}${reason}`;
}

export class Wallet implements WalletController {
  readonly profile: WalletProfileId;
  readonly accounts: { A: Hex; B: Hex };
  /** Wallets the dApp asked the user something through (connect, sign, switch); passive reads don't count. */
  readonly usedWallets = new Set<WalletProfileId>();

  private readonly keys: { A: PrivateKeyAccount; B: PrivateKeyAccount };
  private current: "A" | "B" = "A";
  private chain: number;
  private connected = false;
  private pol: WalletPolicy;
  private readonly reqs: WalletRequest[] = [];
  private readonly pending = new Map<string, Pending>();
  private readonly signQueue: PendingSignRequest[] = [];
  private readonly signWaiters: ((p: PendingSignRequest) => void)[] = [];
  private readonly listeners = new Set<(req: WalletRequest) => void>();
  private unknownChainDone = false;
  /** What the user will say no to when it is next asked. */
  private readonly toRefuse = new Set<"connect" | "switch">();
  private passthroughCalls = 0;
  private emitter: (event: string, args: unknown) => Promise<void> = async () => {};
  private rpcHints: () => string[] = () => [];
  private readonly chains: ChainController;
  private readonly log: (m: string) => void;

  constructor(opts: WalletOptions) {
    this.profile = opts.profile;
    this.chains = opts.chains;
    this.chain = opts.startChainId;
    this.connected = opts.connected ?? false;
    this.pol = { ...DEFAULT_POLICY, ...opts.policy };
    this.log = opts.log ?? (() => {});
    const keyA = opts.accounts?.A ?? generatePrivateKey();
    const keyB = opts.accounts?.B ?? generatePrivateKey();
    this.keys = { A: privateKeyToAccount(keyA as Hex), B: privateKeyToAccount(keyB as Hex) };
    this.accounts = { A: this.keys.A.address, B: this.keys.B.address };
  }

  /** The session installs the function that emits provider events into the page(s). */
  setEmitter(fn: (event: string, args: unknown) => Promise<void>): void {
    this.emitter = fn;
  }

  /** The session installs where to look for an RPC of a chain the app wants but never offered one for. */
  setRpcHints(fn: () => string[]): void {
    this.rpcHints = fn;
  }

  // ------------------------------------------------------------ WalletController

  address(): Hex {
    return this.accounts[this.current];
  }
  chainId(): number {
    return this.chain;
  }
  policy(): WalletPolicy {
    return { ...this.pol };
  }
  requests(): WalletRequest[] {
    return [...this.reqs];
  }
  isConnected(): boolean {
    return this.connected;
  }

  /** Signing requests waiting for an answer that nobody has taken yet. */
  peekSigns(): PendingSignRequest[] {
    return [...this.signQueue];
  }

  nextSign(timeoutMs: number): Promise<PendingSignRequest> {
    const queued = this.signQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.signWaiters.indexOf(waiter);
        if (i >= 0) this.signWaiters.splice(i, 1);
        reject(new Error(`the dApp sent no signing request within ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);
      const waiter = (p: PendingSignRequest) => {
        clearTimeout(timer);
        resolve(p);
      };
      this.signWaiters.push(waiter);
    });
  }

  async approve(requestId: string): Promise<unknown> {
    const p = this.take(requestId);
    const res = await p.run();
    p.req.outcome = res.error ? "errored" : "approved";
    p.req.result = res.result;
    p.req.error = res.error ? errorLine(res.error) : undefined;
    p.settle(res);
    this.notify(p.req);
    if (res.error) throw new JsonRpcError(res.error.code, res.error.message, res.error.data);
    return res.result;
  }

  async reject(requestId: string, code = 4001, message?: string): Promise<void> {
    const p = this.take(requestId);
    const err = code === 4001 && !message ? WalletErrors.userRejected() : new JsonRpcError(code, message ?? "User rejected the request.");
    p.req.outcome = "rejected";
    p.req.error = `${err.code} ${err.message}`;
    p.settle({ error: err.toJSON() });
    this.notify(p.req);
  }

  refuseNext(what: "connect" | "switch"): void {
    this.toRefuse.add(what);
  }

  refusing(what: "connect" | "switch", keep?: false): boolean {
    return keep === false ? this.toRefuse.delete(what) : this.toRefuse.has(what);
  }

  /** The user says no to this request, when that was asked for. */
  private refuse(what: "connect" | "switch"): void {
    if (!this.toRefuse.delete(what)) return;
    this.log(`wallet: refused the request to ${what === "connect" ? "connect" : "switch network"}, as asked`);
    throw WalletErrors.userRejected();
  }

  async switchAccount(to: "A" | "B"): Promise<void> {
    if (this.current === to) return;
    this.current = to;
    this.log(`wallet: switched to account ${to} (${this.address()})`);
    if (this.connected) await this.emitter("accountsChanged", [this.address()]);
  }

  async switchChain(chainId: number): Promise<void> {
    if (this.chain === chainId) return;
    this.chain = chainId;
    this.log(`wallet: switched to chain ${chainId}`);
    await this.emitter("chainChanged", toHex(chainId));
  }

  onRequest(cb: (req: WalletRequest) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /**
   * The page that asked loaded a new document or closed. Nobody is left to answer its open requests,
   * and approving one later would send for a page that's gone, so they are rejected and dropped.
   */
  pageGone(page: object): void {
    for (const [id, p] of [...this.pending]) {
      if (p.ctx.page !== page) continue;
      this.log(`wallet: the page left while ${p.req.method} was open; rejected it`);
      void this.reject(id, 4001, "The page that asked was reloaded or left.");
    }
  }

  /** Reject whatever is still open (session is closing). */
  async closeAll(): Promise<void> {
    for (const id of [...this.pending.keys()]) await this.reject(id, 4001, "User rejected the request.");
  }

  // ------------------------------------------------------------ bridge

  /** Entry point for every request the page-side provider forwards. */
  async handle(req: BridgeRequest, ctx: RequestContext): Promise<BridgeResponse> {
    if (req.method === "__state") return { result: { chainId: toHex(this.chain), accounts: this.connected ? [this.address()] : [] } };
    const record: WalletRequest = {
      id: newId("req"),
      method: req.method,
      params: req.params ?? [],
      chainId: this.chain,
      from: this.connected ? this.address() : undefined,
      wallet: req.wallet,
      kind: kindOf(req.method),
      at: nowIso(),
      outcome: "pending",
    };
    if (record.kind !== "other") this.usedWallets.add(req.wallet);
    this.reqs.push(record);
    this.notify(record);
    try {
      const res = await this.dispatch(record, req, ctx);
      if (record.outcome === "pending") {
        record.outcome = res.error ? "errored" : "approved";
        record.result = res.result;
        record.error = res.error ? errorLine(res.error) : undefined;
        this.notify(record);
      }
      return res;
    } catch (e) {
      const error = toRpcError(e);
      record.outcome = error.code === 4001 ? "rejected" : "errored";
      record.error = errorLine(error);
      this.notify(record);
      return { error };
    }
  }

  private async dispatch(record: WalletRequest, req: BridgeRequest, ctx: RequestContext): Promise<BridgeResponse> {
    const { method } = req;
    const params = Array.isArray(req.params) ? req.params : req.params === undefined || req.params === null ? [] : [req.params];
    const hexChain = toHex(this.chain);

    switch (method) {
      case "eth_chainId":
        return { result: hexChain };
      case "net_version":
        return { result: String(this.chain) };
      case "eth_accounts":
      case "eth_coinbase":
        return { result: method === "eth_accounts" ? (this.connected ? [this.address()] : []) : this.connected ? this.address() : null };

      case "eth_requestAccounts":
      case "wallet_requestPermissions": {
        const result = () => (method === "eth_requestAccounts" ? [this.address()] : this.permissions());
        if (this.connected) return { result: result() };
        this.refuse("connect");
        const connect = async (): Promise<BridgeResponse> => {
          this.connected = true;
          return { result: result(), emit: [{ event: "accountsChanged", args: [this.address()] }] };
        };
        if (this.pol.autoConnect) return connect();
        return this.defer(record, req, ctx, connect);
      }
      case "wallet_getPermissions":
        return { result: this.connected ? this.permissions() : [] };
      case "wallet_revokePermissions": {
        this.connected = false;
        return { result: null, emit: [{ event: "accountsChanged", args: [] }] };
      }

      case "wallet_switchEthereumChain": {
        const target = chainIdParam(params[0]);
        if (this.pol.unknownChainOnce && !this.unknownChainDone) {
          this.unknownChainDone = true;
          throw WalletErrors.unrecognizedChain(toHex(target));
        }
        if (!this.chains.has(target)) throw WalletErrors.unrecognizedChain(toHex(target));
        if (target === this.chain) return { result: null };
        this.refuse("switch");
        const doSwitch = async (): Promise<BridgeResponse> => {
          this.chain = target;
          record.chainId = target;
          return { result: null, emit: [{ event: "chainChanged", args: toHex(target) }] };
        };
        if (this.pol.autoSwitch) return doSwitch();
        return this.defer(record, req, ctx, doSwitch);
      }
      case "wallet_addEthereumChain": {
        const target = chainIdParam(params[0]);
        if (!this.chains.has(target)) {
          // Approve it as a user would: the run takes the chain on (often one detection
          // couldn't see from the landing page) and later runs start with it.
          const p = (params[0] ?? {}) as { chainName?: unknown; rpcUrls?: unknown };
          const rpcUrls = Array.isArray(p.rpcUrls) ? p.rpcUrls.filter((u): u is string => typeof u === "string") : [];
          try {
            await this.chains.addFromApp({ id: target, name: typeof p.chainName === "string" ? p.chainName : undefined, rpcUrls });
          } catch (e) {
            this.log(`wallet: can't add chain ${target}: ${(e as Error).message}`);
            throw WalletErrors.userRejected();
          }
        }
        if (target === this.chain) return { result: null };
        this.refuse("switch");
        this.chain = target;
        return { result: null, emit: [{ event: "chainChanged", args: toHex(target) }] };
      }

      case "wallet_watchAsset":
        return { result: true };
      case "wallet_getCapabilities":
        return { result: Object.fromEntries(this.chains.configs().map((c) => [toHex(c.id), {}])) };
      case "wallet_getCallsStatus":
        return { result: await this.callsStatus(String(params[0])) };
      case "wallet_showCallsStatus":
        return { result: null };
      case "personal_ecRecover": {
        const [message, signature] = params as [string, Hex];
        const raw = isHex(message) ? ({ raw: message } as const) : message;
        return { result: (await recoverMessageAddress({ message: raw, signature })).toLowerCase() };
      }
      case "eth_decrypt":
      case "eth_getEncryptionPublicKey":
        throw WalletErrors.unsupportedMethod(method);

      case "eth_sendTransaction":
      case "eth_signTransaction":
      case "personal_sign":
      case "eth_sign":
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4":
      case "wallet_sendCalls": {
        if (!this.connected) throw WalletErrors.unauthorized();
        // Messages sign on any network, as in MetaMask; transactions need the chain.
        const signsMessage = method === "personal_sign" || method === "eth_sign" || method.startsWith("eth_signTypedData");
        if (!signsMessage && !this.chains.has(this.chain)) throw WalletErrors.chainDisconnected(this.chain);
        if (method.startsWith("eth_signTypedData")) await this.learnChain(typedDataChainId(params));
        const run = () => this.sign(method, params).then((result) => ({ result }) as BridgeResponse, (e) => ({ error: toRpcError(e) }) as BridgeResponse);
        if (this.pol.autoSign) {
          const res = await run();
          if (res.error) throw new JsonRpcError(res.error.code, res.error.message, res.error.data);
          return res;
        }
        return this.defer(record, req, ctx, run);
      }

      default:
        if (method.startsWith("wallet_") || method.startsWith("__")) throw WalletErrors.methodNotFound(method);
        return { result: await this.read(method, params) };
    }
  }

  /**
   * Typed data bound to a chain we don't have means the app works on that chain, even
   * when it never asked the wallet to add or switch to it (it signs for its own chain
   * straight away). Take that chain on so later runs begin on it. The request itself
   * still fails below, as MetaMask refuses typed data for another chain than its own.
   */
  private async learnChain(chainId: number | undefined): Promise<void> {
    if (chainId === undefined || chainId === this.chain || this.chains.has(chainId)) return;
    try {
      await this.chains.addFromApp({ id: chainId, rpcUrls: [], rpcHints: this.rpcHints() });
    } catch (e) {
      this.log(`wallet: the app asked to sign for chain ${chainId}, which couldn't be reached: ${(e as Error).message}`);
      return;
    }
    // The Ethereum fallback was our guess, not the app's choice: move to the chain the app uses.
    if (this.chains.configs().find((c) => c.id === this.chain)?.fallback) await this.switchChain(chainId);
  }

  /** Read-only call: forward to the chain the wallet is on. */
  private async read(method: string, params: unknown[]): Promise<unknown> {
    if (this.chains.has(this.chain)) {
      try {
        return await this.chains.request(this.chain, method, params);
      } catch (e) {
        throw nodeError(e);
      }
    }
    // Wallet parked on a chain we don't have (wrong-network): a real wallet would still
    // read from that network, so forward a bounded number of calls to its public RPC.
    const known = KNOWN_CHAINS.find((c) => c.id === this.chain);
    if (!known || this.passthroughCalls >= PASSTHROUGH_CAP) throw WalletErrors.chainDisconnected(this.chain);
    this.passthroughCalls++;
    try {
      return await rpcCall(known.rpcUrl, method, params, { timeoutMs: 15_000 });
    } catch (e) {
      throw nodeError(e);
    }
  }

  private async sign(method: string, params: unknown[]): Promise<unknown> {
    const chain = this.chain;
    const account = this.keys[this.current];
    const addressParam = (i: number) => {
      const a = params[i];
      if (typeof a === "string" && a.toLowerCase() !== account.address.toLowerCase()) throw WalletErrors.unauthorized();
    };
    switch (method) {
      case "personal_sign":
        addressParam(1);
        return signPersonal(account, params);
      case "eth_sign":
        addressParam(0);
        return signEthSign(account, params);
      case "eth_signTypedData":
      case "eth_signTypedData_v3":
      case "eth_signTypedData_v4": {
        addressParam(0);
        return signTypedData(account, params, this.chain);
      }
      case "eth_sendTransaction": {
        const tx = (params[0] ?? {}) as TxRequest;
        let prepared: PreparedTx;
        try {
          prepared = await prepareTransaction(this.chains, chain, account.address, tx);
        } catch (e) {
          throw e instanceof JsonRpcError && e.code === -32602 ? e : nodeError(e);
        }
        const hash = await sendPrepared(this.chains, account, prepared);
        this.log(`wallet: sent ${hash} on chain ${chain} (nonce ${prepared.nonce})`);
        return hash;
      }
      case "eth_signTransaction": {
        const prepared = await prepareTransaction(this.chains, chain, account.address, (params[0] ?? {}) as TxRequest);
        return account.signTransaction({ ...prepared, type: "eip1559" });
      }
      case "wallet_sendCalls": {
        const batch = (params[0] ?? {}) as { calls?: TxRequest[]; chainId?: string };
        if (batch.chainId && hexToNumber(batch.chainId) !== chain) throw WalletErrors.invalidParams("wallet_sendCalls chainId does not match the wallet's chain");
        const id = newId("calls");
        const hashes: Hex[] = [];
        for (const call of batch.calls ?? []) {
          const prepared = await prepareTransaction(this.chains, chain, account.address, { ...call, from: account.address });
          hashes.push(await sendPrepared(this.chains, account, prepared));
        }
        this.batches.set(id, { chainId: chain, hashes });
        return { id };
      }
      default:
        throw WalletErrors.unsupportedMethod(method);
    }
  }

  private readonly batches = new Map<string, { chainId: number; hashes: Hex[] }>();

  private async callsStatus(id: string): Promise<unknown> {
    const b = this.batches.get(id);
    if (!b) throw WalletErrors.invalidParams(`unknown calls id ${id}`);
    const receipts = await Promise.all(b.hashes.map((h) => this.chains.request(b.chainId, "eth_getTransactionReceipt", [h])));
    const done = receipts.every(Boolean);
    return { version: "2.0.0", id, chainId: toHex(b.chainId), atomic: false, status: done ? 200 : 100, receipts: done ? receipts : [] };
  }

  /** Park an interactive request until approve()/reject() answers it. */
  private defer(record: WalletRequest, req: BridgeRequest, ctx: RequestContext, run: () => Promise<BridgeResponse>): Promise<BridgeResponse> {
    return new Promise<BridgeResponse>((settle) => {
      const p: Pending = { req: record, ctx, wallet: req.wallet, settle, run };
      this.pending.set(record.id, p);
      if (record.kind === "sign") {
        const sign: PendingSignRequest = { request: record, buttonLabel: ctx.buttonLabel, pageUrl: ctx.pageUrl, clickSeq: ctx.clickSeq, wallet: req.wallet };
        const waiter = this.signWaiters.shift();
        if (waiter) waiter(sign);
        else this.signQueue.push(sign);
      }
    });
  }

  private take(requestId: string): Pending {
    const p = this.pending.get(requestId);
    if (!p) throw new Error(`wallet request ${requestId} is not pending`);
    this.pending.delete(requestId);
    const qi = this.signQueue.findIndex((s) => s.request.id === requestId);
    if (qi >= 0) this.signQueue.splice(qi, 1);
    return p;
  }

  private permissions() {
    return [
      {
        id: newId("perm"),
        parentCapability: "eth_accounts",
        invoker: "",
        caveats: [{ type: "restrictReturnedAccounts", value: [this.address()] }],
        date: Date.now(),
      },
    ];
  }

  private notify(req: WalletRequest): void {
    for (const cb of this.listeners) {
      try {
        cb(req);
      } catch {
        /* a listener must not break the wallet */
      }
    }
  }
}

export function kindOf(method: string): WalletRequest["kind"] {
  if (method === "eth_requestAccounts" || method === "wallet_requestPermissions") return "connect";
  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return "switch";
  if ((SIGN_METHODS as readonly string[]).includes(method)) return "sign";
  return "other";
}

function chainIdParam(p: unknown): number {
  const id = (p as { chainId?: unknown } | undefined)?.chainId;
  if (typeof id !== "string" || !/^0x[0-9a-fA-F]+$/.test(id)) throw WalletErrors.invalidParams(`expected chainId as a 0x-prefixed hex string, got ${JSON.stringify(id)}`);
  return Number.parseInt(id, 16);
}
