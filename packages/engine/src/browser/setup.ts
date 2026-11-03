/**
 * The owner's test setup for their app: localStorage it reads at startup (a
 * fork mode, a feature flag) and requests answered with a fixed body (a
 * version check, a backend that disagrees with the fork).
 */
import type { BrowserContext } from "playwright";
import type { FixedResponse } from "@dappdrill/core";

/** Sets the entries on the app's own origin before any of its code runs, on every load. */
export async function installStorage(context: BrowserContext, appUrl: string, storage: Record<string, string>): Promise<void> {
  if (Object.keys(storage).length === 0) return;
  const origin = new URL(appUrl).origin;
  await context.addInitScript(
    ({ origin, storage }) => {
      if (location.origin !== origin) return;
      try {
        for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
      } catch {
        /* storage disabled in this frame */
      }
    },
    { origin, storage },
  );
}

/** Answers matching requests from the list; the first match wins. */
export async function installResponses(context: BrowserContext, responses: FixedResponse[]): Promise<void> {
  if (responses.length === 0) return;
  const matchers = responses.map((r) => ({ r, test: urlMatcher(r.url) }));
  await context.route(
    (url) => matchers.some((m) => m.test(url.href)),
    (route) => {
      const { r } = matchers.find((m) => m.test(route.request().url()))!;
      return route.fulfill({
        status: r.status,
        contentType: r.contentType ?? (isJson(r.body) ? "application/json" : "text/plain"),
        headers: { "access-control-allow-origin": "*" },
        body: r.body,
      });
    },
  );
}

/** Full-URL match with `*` wildcards; without a "?" in the pattern the query string is ignored. */
export function urlMatcher(pattern: string): (url: string) => boolean {
  const re = new RegExp(`^${pattern.split("*").map(escape).join(".*")}$`, "i");
  const withQuery = pattern.includes("?");
  return (url) => re.test(withQuery ? url : url.split(/[?#]/)[0]!);
}

function escape(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}
