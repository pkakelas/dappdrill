const MIN = 60_000;
const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export function timeAgo(d: Date | string | null | undefined, now = Date.now()): string {
  if (!d) return "never";
  const t = new Date(d).getTime();
  const diff = now - t;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h ago`;
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY);
    return days === 1 ? "yesterday" : `${days} days ago`;
  }
  return shortDate(d);
}

export function shortDate(d: Date | string): string {
  const date = new Date(d);
  const sameYear = date.getUTCFullYear() === new Date().getUTCFullYear();
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), timeZone: "UTC" });
}

export function dateTime(d: Date | string): string {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }) + " UTC";
}

export function minutesBetween(a: Date | string | null, b: Date | string | null): string {
  if (!a || !b) return "";
  const m = Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / MIN));
  return `${m} min`;
}

/** "44s", "1m 23s". */
export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host;
  } catch {
    return url;
  }
}

const OPEN_FAILED: [RegExp, string][] = [
  [/ERR_NAME_NOT_RESOLVED/, "that address doesn't exist"],
  [/ERR_CONNECTION_REFUSED|ERR_EMPTY_RESPONSE/, "nothing answered there"],
  [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|Timeout \d+ms exceeded/, "it took too long to answer"],
  [/ERR_CERT_/, "its certificate isn't valid"],
  [/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED/, "the network dropped"],
];

/** Failures of our own workings, which say nothing to the app's owner. */
const OURS = /agent run failed|not logged in|\/login|api[ _-]?key|rate limit|overloaded|ECONN|ENOENT|EPIPE|spawn |exit code|\bat \S+ \(/i;

/** What is said of a failure of our own workings: nothing the app's owner can act on. */
export const OUR_SIDE = "Something went wrong on our side.";

/** An error from our side as a sentence: the browser's network errors in words, and never a call log or our own workings. */
export function plainError(error: string, url?: string): string {
  const [first = error] = error.split(/\n|\s+Call log:/);
  if (/page\.goto|net::ERR_/.test(first)) for (const [pattern, why] of OPEN_FAILED) if (pattern.test(first)) return `We couldn't open ${url ? hostFromUrl(url) : "the app"}: ${why}.`;
  if (OURS.test(first)) return OUR_SIDE;
  return first.replace(/^[\w.]+: /, "").trim();
}

/**
 * Words a run or a model wrote, made fit to read on a line: a whole address or hash shortened, and what only
 * helps whoever repairs the test left out (the other buttons on the page, a wallet request's raw data, a figure in wei).
 */
export function tidy(text: string): string {
  return text
    .replace(/\s*The buttons there: [\s\S]*$/, "")
    .replace(/:\s*\{"[\s\S]*\}\.?\s*$/, ".")
    .replace(/\s*\(\d{6,} wei\)/g, "")
    .replace(/^The wallet was asked: eth_signTypedData(_v\d)? /, "The wallet was asked to sign a ")
    .replace(/\b0x([0-9a-fA-F]{4})[0-9a-fA-F]{32,}([0-9a-fA-F]{4})\b/g, "0x$1…$2")
    .replace(/\s+/g, " ")
    .trim();
}

export const TRIGGER_LABEL = { manual: "Run by you", make: "When the tests were generated", schedule: "Daily run", repair: "After a repair" } as const;
