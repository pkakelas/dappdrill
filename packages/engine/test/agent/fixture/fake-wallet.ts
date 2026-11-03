/**
 * In-memory WalletController for agent tests: injects a minimal EIP-1193
 * provider into the page, records every request, auto-answers connect/switch
 * and holds signing requests until the test (or the agent) approves/rejects.
 */
import type { BrowserContext } from "playwright";
import { newId, nowIso, type WalletProfileId, type WalletRequest } from "@dappdrill/core";
import type { Hex, PendingSign, WalletController, WalletPolicy } from "../../../src/types.js";

const BINDING = "__ddTestWallet";
const SIGN = new Set(["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "eth_signTypedData", "eth_sign"]);

export class FakeWallet implements WalletController {
  readonly profile: WalletProfileId = "metamask";
  readonly accounts = {
    A: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
    B: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
  };
  private selected: "A" | "B" = "A";
  private chain = 31337;
  private pol: WalletPolicy = { autoConnect: true, autoSwitch: true, unknownChainOnce: false, autoSign: false };
  private log: WalletRequest[] = [];
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: { code: number; message: string }) => void }>();
  private waiters: Array<(p: PendingSign) => void> = [];
  private listeners: Array<(req: WalletRequest) => void> = [];
  private lastLabel: () => string | undefined = () => undefined;
  private pageUrl: () => string = () => "";

  address() { return this.accounts[this.selected]; }
  chainId() { return this.chain; }
  policy() { return this.pol; }
  setPolicy(patch: Partial<WalletPolicy>) { Object.assign(this.pol, patch); }
  requests() { return this.log; }
  onRequest(cb: (req: WalletRequest) => void) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter((l) => l !== cb); };
  }
  async switchAccount(to: "A" | "B") { this.selected = to; }
  async switchChain(chainId: number) { this.chain = chainId; }
  async disconnect() {}

  nextSign(timeoutMs: number): Promise<PendingSign> {
    const open = this.log.find((r) => r.kind === "sign" && r.outcome === "pending");
    if (open) return Promise.resolve(this.pendingSign(open));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== wake);
        reject(new Error(`No signing request within ${timeoutMs}ms`));
      }, timeoutMs);
      const wake = (p: PendingSign) => { clearTimeout(timer); resolve(p); };
      this.waiters.push(wake);
    });
  }

  async approve(requestId: string): Promise<unknown> {
    const req = this.log.find((r) => r.id === requestId);
    const p = this.pending.get(requestId);
    if (!req || !p) throw new Error(`No pending request ${requestId}`);
    const result = req.method === "eth_sendTransaction" ? `0x${"ab".repeat(32)}` : `0x${"cd".repeat(65)}`;
    req.outcome = "approved";
    req.result = result;
    this.pending.delete(requestId);
    p.resolve(result);
    return result;
  }

  async reject(requestId: string, code = 4001, message = "User rejected the request"): Promise<void> {
    const req = this.log.find((r) => r.id === requestId);
    const p = this.pending.get(requestId);
    if (!req || !p) throw new Error(`No pending request ${requestId}`);
    req.outcome = "rejected";
    req.error = message;
    this.pending.delete(requestId);
    p.reject({ code, message });
  }

  /** Install the provider into every page of the context. */
  async attach(context: BrowserContext, hooks: { lastClickedLabel: () => string | undefined; pageUrl: () => string }) {
    this.lastLabel = hooks.lastClickedLabel;
    this.pageUrl = hooks.pageUrl;
    await context.exposeBinding(BINDING, (_src, method: string, params: unknown) => this.handle(method, params));
    await context.addInitScript(installProvider, { binding: BINDING, chainId: this.chain, address: this.address() });
  }

  private pendingSign(req: WalletRequest): PendingSign {
    return { request: req, buttonLabel: this.lastLabel(), pageUrl: this.pageUrl() };
  }

  private async handle(method: string, params: unknown): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    const kind: WalletRequest["kind"] =
      method === "eth_requestAccounts" || method === "wallet_requestPermissions" ? "connect"
      : method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain" ? "switch"
      : SIGN.has(method) ? "sign" : "other";
    const req: WalletRequest = { id: newId("req"), method, params, chainId: this.chain, from: this.address(), kind, at: nowIso(), outcome: "pending" };
    this.log.push(req);
    for (const l of this.listeners) l(req);

    if (kind === "connect" || method === "eth_accounts") { req.outcome = "approved"; req.result = [this.address()]; return { result: req.result }; }
    if (method === "eth_chainId") { req.outcome = "approved"; req.result = `0x${this.chain.toString(16)}`; return { result: req.result }; }
    if (kind === "switch") { req.outcome = "approved"; return { result: null }; }
    if (kind !== "sign") { req.outcome = "errored"; return { error: { code: 4200, message: `Unsupported method ${method}` } }; }

    const answer = new Promise<unknown>((resolve, reject) => this.pending.set(req.id, { resolve, reject }));
    const waiter = this.waiters.shift();
    if (waiter) waiter(this.pendingSign(req));
    if (this.pol.autoSign) void this.approve(req.id);
    try {
      return { result: await answer };
    } catch (e) {
      return { error: e as { code: number; message: string } };
    }
  }
}

function installProvider(cfg: { binding: string; chainId: number; address: string }) {
  const w = window as unknown as Record<string, unknown>;
  const bridge = w[cfg.binding] as (method: string, params: unknown) => Promise<{ result?: unknown; error?: { code: number; message: string } }>;
  const listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const provider = {
    isMetaMask: true,
    chainId: `0x${cfg.chainId.toString(16)}`,
    selectedAddress: null as string | null,
    async request({ method, params }: { method: string; params?: unknown }) {
      const res = await bridge(method, params ?? []);
      if (res.error) {
        const err = Object.assign(new Error(res.error.message), { code: res.error.code });
        throw err;
      }
      if (method === "eth_requestAccounts") provider.selectedAddress = (res.result as string[])[0] ?? null;
      return res.result;
    },
    on(event: string, cb: (...a: unknown[]) => void) { (listeners[event] ??= []).push(cb); return provider; },
    removeListener(event: string, cb: (...a: unknown[]) => void) { listeners[event] = (listeners[event] ?? []).filter((l) => l !== cb); return provider; },
  };
  Object.defineProperty(window, "ethereum", { value: provider, configurable: true });
}
