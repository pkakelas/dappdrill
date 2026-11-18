/**
 * The page's own fetch/XHR traffic: which servers it asked, and which said no and why. JSON-RPC
 * is left out: the RPC log records it.
 */
import type { BrowserContext, Request } from "playwright";

/** Analytics, error reporting and wallet relays fail all the time without the app noticing. */
const NOISE = /sentry|google-analytics|analytics\.google|googletagmanager|doubleclick|adnxs|launchdarkly|segment\.(io|com)|mixpanel|amplitude|hotjar|posthog|datadoghq|intercom|cloudflareinsights|vercel-insights|walletconnect|web3modal|reown|privy|coinbase\.com\/.*metrics/i;
/** The part of NOISE that also signs users in. */
const SIGN_IN = /privy|walletconnect|web3modal|reown/i;

/** An error answer is short; anything longer is a page, not a reason. */
const MAX_REFUSAL = 2_000;
const MAX_REFUSALS = 50;

export class Traffic {
  private readonly seen = new Set<string>();
  /** Error answers that said why, newest last. */
  private readonly refusals: { host: string; status: number; said: string; at: number }[] = [];

  install(context: BrowserContext): void {
    context.on("request", (r) => {
      if (tracked(r)) this.seen.add(new URL(r.url()).origin);
    });
    context.on("requestfinished", (r) => {
      // A sign-in provider's requests are noise, but its "no" is what a failed login needs.
      const host = tracked(r) ?? saysWhy(r);
      if (!host) return;
      void r.response().then(
        (res) => {
          if (!res || res.status() < 400) return;
          const status = res.status();
          void res.text().then(
            (body) => {
              const said = refusalIn(body);
              if (said) this.refusals.push({ host, status, said, at: Date.now() });
              if (this.refusals.length > MAX_REFUSALS) this.refusals.shift();
            },
            () => {},
          );
        },
        () => {},
      );
    });
  }

  /** Servers that refused something since `at` and said why: "auth.privy.io answered 400: “User limit reached”". */
  refusedSince(at: number): string[] {
    const lines = this.refusals.filter((r) => r.at >= at).map((r) => `${r.host} answered ${r.status}: “${r.said}”`);
    return [...new Set(lines)].slice(0, 2);
  }

  /** Origins the page fetched from, ones on the app's own site (e.g. app.x.dev → node.x.dev) first. */
  origins(appUrl: string): string[] {
    const site = siteOf(new URL(appUrl).hostname);
    const all = [...this.seen];
    const own = all.filter((o) => siteOf(new URL(o).hostname) === site);
    return [...own, ...all.filter((o) => !own.includes(o))];
  }
}

function tracked(r: Request): string | undefined {
  return NOISE.test(r.url()) ? undefined : asked(r);
}

/** A wallet or sign-in provider (in NOISE for its relays) whose error answer is still worth reading; its event reporting is not. */
function saysWhy(r: Request): string | undefined {
  return SIGN_IN.test(r.url()) && !/analytics|telemetry|metrics|events?\b/i.test(r.url()) ? asked(r) : undefined;
}

/** The host of a fetch or XHR of the page's own, JSON-RPC apart. */
function asked(r: Request): string | undefined {
  const type = r.resourceType();
  if (type !== "fetch" && type !== "xhr") return undefined;
  if (/"jsonrpc"\s*:/.test(r.postData() ?? "")) return undefined;
  try {
    const url = new URL(r.url());
    return /^https?:$/.test(url.protocol) ? url.host : undefined;
  } catch {
    return undefined;
  }
}

/** The reason an error answer gives, when it is JSON with one: {"error":"User limit reached"}, {"error":{"message":…}}, {"message":…}. */
export function refusalIn(body: string): string | undefined {
  if (body.length > MAX_REFUSAL) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const reason = (node: unknown, depth = 0): string | undefined => {
    if (typeof node === "string") return node.trim() || undefined;
    if (!node || typeof node !== "object" || Array.isArray(node) || depth > 1) return undefined;
    const o = node as Record<string, unknown>;
    for (const key of ["error", "message", "error_description", "detail", "reason"]) {
      const found = reason(o[key], depth + 1);
      if (found) return found;
    }
    return undefined;
  };
  return typeof json === "string" ? undefined : reason(json)?.slice(0, 160);
}

/** The last two labels of a hostname: good enough to tell the app's own hosts from third parties. */
function siteOf(hostname: string): string {
  return hostname.split(".").slice(-2).join(".");
}
