/**
 * Page-side wallet: an EIP-1193 provider that behaves like MetaMask (or Rabby /
 * Coinbase Wallet), announced through EIP-6963. Every request is forwarded to
 * node through a Playwright binding; node answers with a result or an EIP-1193
 * error plus any events to emit afterwards (accountsChanged, chainChanged…).
 *
 * `installDappDrillWallet` runs inside the page, so it must stay self-contained:
 * no imports, no closures over module scope.
 */
import type { WalletProfileId } from "@dappdrill/core";

export interface InjectedWalletInfo {
  id: WalletProfileId;
  uuid: string;
}

export interface InjectConfig {
  /** First entry owns window.ethereum. Two entries = "two wallets installed". */
  wallets: InjectedWalletInfo[];
  /** Hex chain id the wallet starts on. */
  chainId: string;
  /** Accounts already connected (usually none). */
  accounts: string[];
  /** Name of the binding exposed with context.exposeBinding. */
  binding: string;
}

export interface BridgeRequest {
  wallet: WalletProfileId;
  method: string;
  params?: unknown;
}

export interface BridgeResponse {
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  /** Events to emit on the provider after answering, in order. */
  emit?: { event: string; args: unknown }[];
}

export const BINDING_NAME = "__dappdrillBridge";

export function installDappDrillWallet(cfg: InjectConfig): void {
  const w = window as any;
  if (w.__dappdrill) return;

  const META: Record<string, { name: string; rdns: string; icon: string }> = {
    metamask: { name: "MetaMask", rdns: "io.metamask", icon: svgIcon("#F6851B", "M") },
    rabby: { name: "Rabby Wallet", rdns: "io.rabby", icon: svgIcon("#8697FF", "R") },
    coinbase: { name: "Coinbase Wallet", rdns: "com.coinbase.wallet", icon: svgIcon("#0052FF", "C") },
  };

  function svgIcon(color: string, letter: string): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><text x="16" y="22" font-family="sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">${letter}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  class ProviderRpcError extends Error {
    code: number;
    data?: unknown;
    constructor(code: number, message: string, data?: unknown) {
      super(message);
      this.name = "ProviderRpcError";
      this.code = code;
      this.data = data;
    }
  }

  const bridge = (req: BridgeRequest): Promise<BridgeResponse> => w[cfg.binding](req);

  type Listener = (...args: any[]) => void;

  function createProvider(info: InjectedWalletInfo) {
    const listeners = new Map<string, Set<Listener>>();
    const state = { chainId: cfg.chainId, accounts: cfg.accounts.slice(), connected: true };

    function emit(event: string, ...args: any[]) {
      if (event === "chainChanged" && typeof args[0] === "string") state.chainId = args[0];
      if (event === "accountsChanged" && Array.isArray(args[0])) state.accounts = args[0].slice();
      if (event === "connect") state.connected = true;
      if (event === "disconnect") state.connected = false;
      for (const fn of [...(listeners.get(event) ?? [])]) {
        try {
          fn(...args);
        } catch (e) {
          console.error(`[dappdrill wallet] listener for ${event} threw`, e);
        }
      }
    }

    async function request(args: unknown): Promise<unknown> {
      if (!args || typeof args !== "object" || typeof (args as any).method !== "string") {
        throw new ProviderRpcError(-32600, "Expected a single, non-array, object argument with a string method.");
      }
      const { method, params } = args as { method: string; params?: unknown };
      if (params !== undefined && params !== null && typeof params !== "object") {
        throw new ProviderRpcError(-32602, `'args.params' must be an object or array if provided.`);
      }
      const res = await bridge({ wallet: info.id, method, params });
      for (const ev of res.emit ?? []) emit(ev.event, ev.args);
      if (res.error) throw new ProviderRpcError(res.error.code, res.error.message, res.error.data);
      return res.result;
    }

    function on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return provider;
    }
    function removeListener(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn);
      return provider;
    }

    /** Legacy callback API (web3.js 0.x, old wagmi connectors). */
    function sendAsync(payload: any, cb: (err: unknown, res?: unknown) => void) {
      const one = (p: any) =>
        request({ method: p.method, params: p.params })
          .then((result) => ({ id: p.id, jsonrpc: "2.0", result }))
          .catch((error) => ({ id: p.id, jsonrpc: "2.0", error: { code: error.code, message: error.message, data: error.data } }));
      if (Array.isArray(payload)) {
        Promise.all(payload.map(one)).then((r) => cb(null, r));
      } else {
        one(payload).then((r) => ((r as any).error ? cb(Object.assign(new Error((r as any).error.message), (r as any).error), r) : cb(null, r)));
      }
    }

    function send(a: any, b?: any): any {
      if (typeof a === "string") return request({ method: a, params: b });
      if (typeof b === "function") return sendAsync(a, b);
      // Synchronous legacy calls MetaMask still answers.
      const sync: Record<string, unknown> = {
        eth_accounts: state.accounts.slice(),
        eth_coinbase: state.accounts[0] ?? null,
        eth_uninstallFilter: false,
        net_version: String(parseInt(state.chainId, 16)),
      };
      if (a && a.method in sync) return { id: a.id, jsonrpc: "2.0", result: sync[a.method] };
      throw new Error(`DappDrill wallet: synchronous send() of ${a?.method} is not supported; use request().`);
    }

    const provider: any = {
      isMetaMask: info.id === "metamask" || info.id === "rabby",
      isRabby: info.id === "rabby",
      isCoinbaseWallet: info.id === "coinbase",
      isDappDrill: true,
      _metamask: { isUnlocked: async () => true },
      _events: listeners,
      get selectedAddress() {
        return state.accounts[0] ?? null;
      },
      get chainId() {
        return state.chainId;
      },
      get networkVersion() {
        return String(parseInt(state.chainId, 16));
      },
      isConnected: () => state.connected,
      request,
      on,
      addListener: on,
      once(event: string, fn: Listener) {
        const wrapped = (...args: any[]) => {
          removeListener(event, wrapped);
          fn(...args);
        };
        return on(event, wrapped);
      },
      removeListener,
      off: removeListener,
      removeAllListeners(event?: string) {
        if (event) listeners.delete(event);
        else listeners.clear();
        return provider;
      },
      listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
      listeners: (event: string) => [...(listeners.get(event) ?? [])],
      emit,
      enable: () => request({ method: "eth_requestAccounts" }),
      send,
      sendAsync,
    };
    Object.defineProperty(provider, "__dappdrillId", { value: info.id, enumerable: false });
    Object.defineProperty(provider, "__dappdrillEmit", { value: emit, enumerable: false });
    Object.defineProperty(provider, "__dappdrillState", { value: state, enumerable: false });
    return provider;
  }

  const providers = cfg.wallets.map((info) => ({ info, provider: createProvider(info) }));
  const primary = providers[0]!;

  w.__dappdrill = {
    lastClicked: undefined as string | undefined,
    emit(event: string, args: unknown, wallet?: string) {
      for (const p of providers) if (!wallet || p.info.id === wallet) p.provider.__dappdrillEmit(event, args);
    },
    wallets: providers.map((p) => p.info.id),
  };

  // window.ethereum and the vendor globals wallets also set.
  try {
    Object.defineProperty(w, "ethereum", { value: primary.provider, configurable: true, writable: true, enumerable: true });
  } catch {
    w.ethereum = primary.provider;
  }
  if (providers.length > 1) primary.provider.providers = providers.map((p) => p.provider);
  for (const p of providers) {
    if (p.info.id === "rabby") w.rabby = p.provider;
    if (p.info.id === "coinbase") w.coinbaseWalletExtension = p.provider;
  }
  window.dispatchEvent(new Event("ethereum#initialized"));

  // EIP-6963
  function announce(p: { info: InjectedWalletInfo; provider: any }) {
    const meta = META[p.info.id]!;
    const detail = Object.freeze({
      info: Object.freeze({ uuid: p.info.uuid, name: meta.name, icon: meta.icon, rdns: meta.rdns }),
      provider: p.provider,
    });
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
  }
  for (const p of providers) announce(p);
  window.addEventListener("eip6963:requestProvider", () => {
    for (const p of providers) announce(p);
  });

  // "The button said": remember the accessible label of whatever was clicked last.
  function labelOf(el: Element): string | undefined {
    const target =
      el.closest("button, a, [role=button], [role=link], [role=menuitem], [role=option], [role=tab], input[type=submit], input[type=button], label, summary") ?? el;
    const aria = target.getAttribute("aria-label");
    if (aria?.trim()) return aria.trim();
    const by = target.getAttribute("aria-labelledby");
    if (by) {
      const text = by
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .join(" ")
        .trim();
      if (text) return text;
    }
    if (target instanceof HTMLInputElement) return target.value || target.placeholder || undefined;
    const text = ((target as HTMLElement).innerText ?? target.textContent ?? "").replace(/\s+/g, " ").trim();
    return (text || target.getAttribute("title") || undefined)?.slice(0, 120);
  }
  document.addEventListener(
    "pointerdown",
    (ev) => {
      const el = ev.target instanceof Element ? ev.target : null;
      if (!el) return;
      const label = labelOf(el);
      w.__dappdrill.lastClicked = label;
      bridge({ wallet: primary.info.id, method: "__click", params: [label ?? null] }).catch(() => {});
    },
    true,
  );

  // After a navigation the page-side state is stale; ask node for the truth.
  bridge({ wallet: primary.info.id, method: "__state" })
    .then((res) => {
      const s = res.result as { chainId: string; accounts: string[] } | undefined;
      if (!s) return;
      for (const p of providers) {
        p.provider.__dappdrillState.chainId = s.chainId;
        p.provider.__dappdrillState.accounts = s.accounts.slice();
        p.provider.__dappdrillEmit("connect", { chainId: s.chainId });
      }
    })
    .catch(() => {});
}

/**
 * Source for context.addInitScript. tsx/esbuild keep function names with a
 * `__name` helper that doesn't exist in the page, hence the shim.
 */
export function walletInitScript(cfg: InjectConfig): string {
  return `(() => { const __name = (f) => f; (${installDappDrillWallet.toString()})(${JSON.stringify(cfg)}); })();`;
}
