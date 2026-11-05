const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

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

export const TRIGGER_LABEL = { manual: "Run by you", analysis: "First run", schedule: "Daily run", agent: "Run by the assistant", explore: "After exploring" } as const;
