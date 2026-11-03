/**
 * Node side of the injected wallet. Answers every request the page-side
 * provider forwards, following the WalletPolicy for interactive requests and
 * signing with viem local accounts. Mirrors MetaMask's error codes and
 * messages so dApps take the same code paths they would with a real wallet.
 */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { recoverMessageAddress, isHex } from "viem";
import { KNOWN_CHAINS, SIGN_METHODS, chainName, newId, nowIso, type WalletProfileId, type WalletRequest } from "@dappdrill/core";
import type { ChainController, Hex, PendingSign, WalletController, WalletPolicy } from "../types.js";
import { JsonRpcError, hexToNumber, rpcCall, toHex, toRpcError } from "../chain/rpc.js";
import { WalletErrors } from "./errors.js";
import type { BridgeRequest, BridgeResponse } from "./inject.js";
import { nodeError, prepareTransaction, sendPrepared, signEthSign, signPersonal, signTypedData, type PreparedTx, type TxRequest } from "./signer.js";

export interface WalletOptions {
  profile: WalletProfileId;
  chains: ChainController;
  /** Hex private keys. Generated when missing. */
  accounts?: { A: string; B: string };
  /** Funded key for live chains; becomes account A when any chain runs live. */
  liveKey?: string;
  startChainId: number;
  policy?: Partial<WalletPolicy>;
  log?: (message: string) => void;
}

/** What the session tells the wallet about the page when a request arrives. */
export interface RequestContext {
  pageUrl: string;
  buttonLabel?: string;
  /** Number of clicks seen so far; two sign requests with the same value came from one click. */
  clickSeq: number;
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

export class Wallet implements WalletController {
  readonly profile: WalletProfileId;
  readonly accounts: { A: Hex; B: Hex };
  /** Wallets the dApp asked the user something through (connect, sign, switch); passive reads don't count. */
  readonly usedWallets = new Set<WalletProfileId>();
  /** Set when a signing request was refused because a live chain has no funded key. */
  needsLiveKey = false;
  /** Last transaction we broadcast; speed-up replaces it. */
  lastTx?: { prepared: PreparedTx; hash: Hex; account: "A" | "B" };

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
  private passthroughCalls = 0;
  private emitter: (event: string, args: unknown) => Promise<void> = async () => {};
  private readonly chains: ChainController;
  private readonly liveKey?: string;
  private readonly log: (m: string) => void;

  constructor(opts: WalletOptions) {
    this.profile = opts.profile;
    this.chains = opts.chains;
    this.liveKey = opts.liveKey;
    this.chain = opts.startChainId;
    this.pol = { ...DEFAULT_POLICY, ...opts.policy };
    this.log = opts.log ?? (() => {});
    const anyLive = opts.chains.configs().some((c) => c.mode === "live");
    const keyA = anyLive && opts.liveKey ? opts.liveKey : (opts.accounts?.A ?? generatePrivateKey());
    const keyB = opts.accounts?.B ?? generatePrivateKey();
    this.keys = { A: privateKeyToAccount(keyA as Hex), B: privateKeyToAccount(keyB as Hex) };
    this.accounts = { A: this.keys.A.address, B: this.keys.B.address };
  }

  /** Give both accounts 100 ETH on every fork. */
  async fundOnForks(): Promise<void> {
    for (const c of this.chains.configs()) {
      if (c.mode !== "fork") continue;
      await this.chains.setBalance(c.id, this.accounts.A, 100n * 10n ** 18n);
      await this.chains.setBalance(c.id, this.accounts.B, 100n * 10n ** 18n);
    }
  }

  /** The session installs the function that emits provider events into the page(s). */
  setEmitter(fn: (event: string, args: unknown) => Promise<void>): void {
    this.emitter = fn;
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
  setPolicy(patch: Partial<WalletPolicy>): void {
    this.pol = { ...this.pol, ...patch };
  }
  requests(): WalletRequest[] {
    return [...this.reqs];
  }
  isConnected(): boolean {
    return this.connected;
  }
  account(): "A" | "B" {
    return this.current;
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
    p.req.error = res.error ? `${res.error.code} ${res.error.message}` : undefined;
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

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    this.log("wallet: disconnected");
    await this.emitter("accountsChanged", []);
  }

  onRequest(cb: (req: WalletRequest) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Reject whatever is still open (session is closing). */
  async closeAll(): Promise<void> {
    for (const id of [...this.pending.keys()]) await this.reject(id, 4001, "User rejected the request.");
  }

  /** Re-broadcast the last transaction with a 30% higher fee and the same nonce. */
  async speedUpLast(): Promise<Hex> {
    if (!this.lastTx) throw new Error("no transaction to speed up");
    const { prepared, account } = this.lastTx;
    const bumped: PreparedTx = {
      ...prepared,
      maxFeePerGas: (prepared.maxFeePerGas * 130n) / 100n,
      maxPriorityFeePerGas: (prepared.maxPriorityFeePerGas * 130n) / 100n,
    };
    const hash = await sendPrepared(this.chains, this.keys[account], bumped);
    this.lastTx = { prepared: bumped, hash, account };
    return hash;
  }

  // ------------------------------------------------------------ bridge

  /** Entry point for every request the page-side provider forwards. */
  async handle(req: BridgeRequest, ctx: RequestContext): Promise<BridgeResponse> {
    if (req.method === "__state") return { result: { chainId: toHex(this.chain), accounts: this.connected ? [this.address()] : [] } };
    const record: WalletRequest = {
      id: newId("req"),
      method: req.method,
      params: req.params,
      chainId: this.chain,
      from: this.connected ? this.address() : undefined,
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
        record.error = res.error ? `${res.error.code} ${res.error.message}` : undefined;
        this.notify(record);
      }
      return res;
    } catch (e) {
      const error = toRpcError(e);
      record.outcome = error.code === 4001 ? "rejected" : "errored";
      record.error = `${error.code} ${error.message}`;
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
        if (!this.chains.has(target)) throw WalletErrors.userRejected();
        if (target === this.chain) return { result: null };
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
        // Without a funded key the live-mode wallet is a throwaway: it signs messages
        // (sign-in, typed data) but can't pay for transactions.
        const sendsTx = method === "eth_sendTransaction" || method === "wallet_sendCalls";
        if (sendsTx && this.chains.has(this.chain) && this.chains.mode(this.chain) === "live" && !this.liveKey) {
          this.needsLiveKey = true;
          throw WalletErrors.needsLiveKey(chainName(this.chain));
        }
        // Messages sign on any network, as in MetaMask; transactions need the chain.
        const signsMessage = method === "personal_sign" || method === "eth_sign" || method.startsWith("eth_signTypedData");
        if (!signsMessage && !this.chains.has(this.chain)) throw WalletErrors.chainDisconnected(this.chain);
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

  /** Read-only call: forward to the chain the wallet is on. */
  private async read(method: string, params: unknown[]): Promise<unknown> {
    if (this.chains.has(this.chain)) {
      try {
        return await this.chains.request(this.chain, method, params);
      } catch (e) {
        throw nodeError(e);
      }
    }
    // Wallet parked on a chain we don't run (wrong-network): a real wallet would still
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
      case "eth_signTypedData_v4":
        addressParam(0);
        return signTypedData(account, params, this.chain);
      case "eth_sendTransaction": {
        const tx = (params[0] ?? {}) as TxRequest;
        let prepared: PreparedTx;
        try {
          prepared = await prepareTransaction(this.chains, this.chain, account.address, tx);
        } catch (e) {
          throw e instanceof JsonRpcError && e.code === -32602 ? e : nodeError(e);
        }
        const hash = await sendPrepared(this.chains, account, prepared);
        this.lastTx = { prepared, hash, account: this.current };
        this.log(`wallet: sent ${hash} on chain ${this.chain} (nonce ${prepared.nonce})`);
        return hash;
      }
      case "eth_signTransaction": {
        const prepared = await prepareTransaction(this.chains, this.chain, account.address, (params[0] ?? {}) as TxRequest);
        return account.signTransaction({ ...prepared, type: "eip1559" });
      }
      case "wallet_sendCalls": {
        const batch = (params[0] ?? {}) as { calls?: TxRequest[]; chainId?: string };
        if (batch.chainId && hexToNumber(batch.chainId) !== this.chain) throw WalletErrors.invalidParams("wallet_sendCalls chainId does not match the wallet's chain");
        const id = newId("calls");
        const hashes: Hex[] = [];
        for (const call of batch.calls ?? []) {
          const prepared = await prepareTransaction(this.chains, this.chain, account.address, { ...call, from: account.address });
          const hash = await sendPrepared(this.chains, account, prepared);
          this.lastTx = { prepared, hash, account: this.current };
          hashes.push(hash);
        }
        this.batches.set(id, { chainId: this.chain, hashes });
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
