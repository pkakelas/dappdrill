/**
 * Bugs we inject into real dApp frontends. Each one is a page script that sits
 * between the dApp and the wallet and changes what the dApp asks for or hears,
 * the way a frontend bug would. The engine can't tell it apart from the dApp's
 * own code, so a replay with the script measures whether DappDrill catches
 * that class of bug on a real site.
 */
import type { EdgeCaseId, IssueCategory, WalletRequest } from "@dappdrill/core";

export interface Mutation {
  id: string;
  /** The frontend bug it imitates, in plain words. */
  bug: string;
  /** Edge cases the replay runs; the bug only shows under these. */
  edgeCases: EdgeCaseId[];
  /** Issue categories that count as naming the bug ("signing" also counts a worse signing review). */
  catches: IssueCategory[];
  /** Whether a flow can hit the bug, judged from the wallet requests of its clean run. */
  relevant: (requests: WalletRequest[]) => boolean;
  /** Page script; logs FIRED_MARK when it changed something, so untriggered runs don't count. */
  script: string;
}

export const FIRED_MARK = "[dappdrill-bench] fired";

type Tx = { data?: string; input?: string; value?: string };
const txs = (requests: WalletRequest[]): Tx[] =>
  requests.filter((r) => r.method === "eth_sendTransaction").map((r) => (Array.isArray(r.params) ? (r.params[0] as Tx) : {}) ?? {});
const isApprove = (tx: Tx) => (tx.data ?? tx.input ?? "").startsWith("0x095ea7b3");
const always = () => true;

const MAX_UINT = "f".repeat(64);
const STRANGER = "000000000000000000000000" + "5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e5a1e";

/** Wraps every injected provider (window.ethereum and EIP-6963 announcements) with `body`. */
function providerPatch(id: string, body: string): string {
  // Bound now, before the dApp loads: production builds often replace console.log with a no-op.
  return `(() => {
  const warn = console.warn.bind(console);
  const fired = (what) => warn(${JSON.stringify(`${FIRED_MARK} ${id}: `)} + what);
  const patched = new WeakSet();
  function patch(provider) {
    if (!provider || patched.has(provider)) return;
    patched.add(provider);
    const request = provider.request.bind(provider);
    ${body}
  }
  patch(window.ethereum);
  for (const p of window.ethereum?.providers ?? []) patch(p);
  window.addEventListener("eip6963:announceProvider", (e) => patch(e.detail?.provider), true);
})();`;
}

/** Rewrites eth_sendTransaction params[0] with `edit(tx)` (returns the new tx, or undefined to leave it). */
function txPatch(id: string, edit: string): string {
  return providerPatch(
    id,
    `provider.request = (args) => {
      if (args?.method === "eth_sendTransaction" && args.params?.[0]) {
        const tx = args.params[0];
        const next = (${edit})(tx);
        if (next) return request({ ...args, params: [next, ...args.params.slice(1)] });
      }
      return request(args);
    };`,
  );
}

export const MUTATIONS: Mutation[] = [
  {
    id: "unlimited-approval",
    bug: "The approve button names an amount, but the dApp requests an unlimited approval.",
    edgeCases: ["happy"],
    catches: ["signing"],
    relevant: (rs) => txs(rs).some((tx) => isApprove(tx) && !(tx.data ?? tx.input ?? "").endsWith(MAX_UINT)),
    script: txPatch(
      "unlimited-approval",
      `(tx) => {
        const data = tx.data ?? tx.input;
        if (typeof data !== "string" || !data.startsWith("0x095ea7b3") || data.length < 138) return;
        if (data.slice(74, 138) === "${MAX_UINT}") return;
        fired("approve amount set to max");
        return { ...tx, data: data.slice(0, 74) + "${MAX_UINT}" + data.slice(138), input: undefined };
      }`,
    ),
  },
  {
    id: "approval-to-stranger",
    bug: "The approval goes to an address that isn't the protocol's contract.",
    edgeCases: ["happy"],
    catches: ["signing"],
    relevant: (rs) => txs(rs).some(isApprove),
    script: txPatch(
      "approval-to-stranger",
      `(tx) => {
        const data = tx.data ?? tx.input;
        if (typeof data !== "string" || !data.startsWith("0x095ea7b3") || data.length < 138) return;
        fired("approve spender replaced");
        return { ...tx, data: data.slice(0, 10) + "${STRANGER}" + data.slice(74), input: undefined };
      }`,
    ),
  },
  {
    id: "inflated-value",
    bug: "The transaction sends ten times the ETH the user typed.",
    edgeCases: ["happy"],
    catches: ["signing"],
    relevant: (rs) => txs(rs).some((tx) => !!tx.value && BigInt(tx.value) > 0n),
    script: txPatch(
      "inflated-value",
      `(tx) => {
        if (!tx.value || BigInt(tx.value) === 0n) return;
        fired("value x10");
        return { ...tx, value: "0x" + (BigInt(tx.value) * 10n).toString(16) };
      }`,
    ),
  },
  {
    id: "signin-is-permit",
    bug: "A plain sign-in message is swapped for an unlimited token permit to a stranger.",
    edgeCases: ["happy"],
    catches: ["signing"],
    relevant: (rs) => rs.some((r) => r.method === "personal_sign"),
    script: providerPatch(
      "signin-is-permit",
      `provider.request = async (args) => {
        if (args?.method !== "personal_sign") return request(args);
        const owner = args.params?.[1];
        const chainId = Number(await request({ method: "eth_chainId" }));
        fired("personal_sign replaced with a permit");
        const typed = {
          types: {
            EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
            Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
          },
          primaryType: "Permit",
          domain: { name: "USD Coin", version: "2", chainId, verifyingContract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
          message: { owner, spender: "0x${STRANGER.slice(24)}", value: "0x${MAX_UINT}", nonce: "0", deadline: "0x${MAX_UINT}" },
        };
        return request({ method: "eth_signTypedData_v4", params: [owner, JSON.stringify(typed)] });
      };`,
    ),
  },
  {
    id: "ignores-account-switch",
    bug: "The dApp never hears that the user switched accounts, so it keeps acting for the old one.",
    edgeCases: ["switch-account"],
    catches: ["wallet"],
    relevant: always,
    script: providerPatch(
      "ignores-account-switch",
      `let first;
      const wrapped = new Map();
      const on = provider.on.bind(provider);
      const off = provider.removeListener.bind(provider);
      const wrap = (fn) => {
        if (!wrapped.has(fn)) {
          wrapped.set(fn, (accounts) => {
            const a = accounts?.[0]?.toLowerCase();
            if (a && first && a !== first) return fired("accountsChanged dropped");
            if (a) first ??= a;
            fn(accounts);
          });
        }
        return wrapped.get(fn);
      };
      // MetaMask's stream and Multichain API also tell the page over postMessage; drop those too.
      window.addEventListener("message", (ev) => {
        const msg = ev.source === window && ev.data?.target === "metamask-inpage" ? ev.data.data?.data : undefined;
        const accounts =
          msg?.method === "metamask_accountsChanged" ? msg.params
          : msg?.method === "wallet_sessionChanged" ? Object.values(msg.params?.sessionScopes ?? {})[0]?.accounts?.map((a) => a.split(":").pop())
          : undefined;
        const a = accounts?.[0]?.toLowerCase();
        if (a && first && a !== first) {
          ev.stopImmediatePropagation();
          fired(msg.method + " dropped");
        }
      }, true);
      provider.on = provider.addListener = (event, fn) => on(event, event === "accountsChanged" ? wrap(fn) : fn);
      provider.removeListener = provider.off = (event, fn) => off(event, wrapped.get(fn) ?? fn);
      provider.request = async (args) => {
        const result = await request(args);
        const method = args?.method;
        if ((method === "eth_accounts" || method === "eth_requestAccounts") && Array.isArray(result) && result[0]) {
          const a = result[0].toLowerCase();
          first ??= a;
          if (a !== first) {
            fired(method + " answered with the old account");
            return [first, ...result.slice(1)];
          }
        }
        return result;
      };`,
    ),
  },
  {
    id: "stuck-on-reject",
    bug: "When the user rejects in the wallet, the dApp's promise never settles, so it waits forever.",
    edgeCases: ["reject"],
    catches: ["wallet", "ui"],
    relevant: (rs) => rs.some((r) => r.kind === "sign"),
    script: providerPatch(
      "stuck-on-reject",
      `provider.request = (args) =>
        request(args).catch((e) => {
          if (e?.code !== 4001) throw e;
          fired("rejection swallowed");
          return new Promise(() => {});
        });`,
    ),
  },
  {
    id: "skips-chain-switch",
    bug: "The dApp's network switch silently does nothing, then it sends on the wrong chain.",
    edgeCases: ["wrong-network"],
    catches: ["wallet"],
    relevant: always,
    script: providerPatch(
      "skips-chain-switch",
      `provider.request = (args) => {
        if (args?.method === "wallet_switchEthereumChain" || args?.method === "wallet_addEthereumChain") {
          fired(args.method + " ignored");
          return Promise.resolve(null);
        }
        return request(args);
      };`,
    ),
  },
];
