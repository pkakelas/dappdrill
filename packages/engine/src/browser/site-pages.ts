/** The same-origin pages an app links to, and which of them a visitor has opened, so a look knows what it hasn't seen. */
import type { Frame, Page } from "playwright";

/** Pages that seldom hold anything a user does in the app. */
const ASIDE = /^\/(terms|tos|privacy|legal|cookies?|docs?|blog|news|faq|help|support|about|careers|jobs|press|brand|media)(\/|$)/i;
const FILE = /\.(pdf|png|jpe?g|svg|gif|webp|zip|json|xml|txt|csv)$/i;
/** Lists (markets, tokens, pools) link to one page per row; a few stand for the rest. */
const PER_PARENT = 2;

/** The same-origin pages an app links to, and which of them a visitor has opened. */
export class SitePages {
  private readonly origin: string;
  private readonly linked = new Map<string, string>();
  private readonly opened = new Set<string>();

  constructor(appUrl: string) {
    this.origin = new URL(appUrl).origin;
  }

  private path(url: string): string | undefined {
    try {
      const u = new URL(url, this.origin);
      if (u.origin !== this.origin || FILE.test(u.pathname)) return undefined;
      return u.pathname.replace(/\/+$/, "") || "/";
    } catch {
      return undefined;
    }
  }

  open(url: string): void {
    const p = this.path(url);
    if (p) this.opened.add(p);
  }

  link(links: { href: string; text: string }[]): void {
    for (const l of links) {
      const p = this.path(l.href);
      if (p && !this.linked.has(p)) this.linked.set(p, l.text);
    }
  }

  /** Linked pages nobody opened, as "/path (link text)", leaving out legal and docs pages and all but a few rows of a list. */
  unopened(): string[] {
    const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
    const seen = new Map<string, number>();
    // A row of a list that was opened stands for its siblings.
    for (const p of this.opened) if (parent(p) !== "/") seen.set(parent(p), PER_PARENT);
    const out: string[] = [];
    for (const [p, text] of this.linked) {
      if (this.opened.has(p) || ASIDE.test(p)) continue;
      const n = seen.get(parent(p)) ?? 0;
      if (parent(p) !== "/") seen.set(parent(p), n + 1);
      if (parent(p) !== "/" && n >= PER_PARENT) continue;
      out.push(text ? `${p} (${text})` : p);
    }
    return out.slice(0, 12);
  }
}

export async function linkedPages(page: Page): Promise<{ href: string; text: string }[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .filter((a) => !a.target || a.target === "_self")
      .map((a) => ({ href: a.href, text: (a.getAttribute("aria-label") ?? a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40) })),
  );
}

/** Keeps track of the pages a visitor opens and of what they link to, from now until `stop`. */
export async function followPages(page: Page, appUrl: string): Promise<{ pages: SitePages; collect(): Promise<void>; stop(): void }> {
  const pages = new SitePages(appUrl);
  const collect = () => linkedPages(page).then((links) => pages.link(links), () => {});
  const onNavigated = (frame: Frame) => {
    if (frame !== page.mainFrame()) return;
    pages.open(frame.url());
    // Links arrive after the route renders.
    setTimeout(() => void collect(), 1_500);
  };
  pages.open(page.url());
  await collect();
  page.on("framenavigated", onNavigated);
  return { pages, collect, stop: () => void page.off("framenavigated", onNavigated) };
}
