/**
 * What the page said, and when: every line of text as it appeared. A notice that shows for three
 * seconds is gone before anything looks for it, so the session keeps it. Text inside a shadow root
 * isn't read, as it isn't when the page's text is read at any other time.
 */
import type { BrowserContext, Page } from "playwright";

const BINDING = "__dappdrillSaid";
const LINE_MAX = 300;
const KEPT = 4_000;
/** The page is read at most this often, however fast it changes. */
const EVERY_MS = 200;

/** Runs in the page: reads its text whenever it changes and sends the lines that weren't there the last time. */
function watch(binding: string, lineMax: number, everyMs: number): void {
  if (window.top !== window) return;
  let before = new Set<string>();
  let waiting = false;
  const read = () => {
    waiting = false;
    if (!document.body) return;
    const now = new Set<string>();
    const fresh: string[] = [];
    for (const raw of document.body.innerText.split("\n")) {
      const line = raw.replace(/\s+/g, " ").trim().slice(0, lineMax);
      // Figures alone tick all day and say nothing.
      if (!/\p{L}{2}/u.test(line) || now.has(line)) continue;
      now.add(line);
      if (!before.has(line)) fresh.push(line);
    }
    before = now;
    if (fresh.length) void (window as unknown as Record<string, (lines: string[]) => Promise<void>>)[binding]!(fresh);
  };
  new MutationObserver(() => {
    if (waiting) return;
    waiting = true;
    setTimeout(read, everyMs);
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
}

export class Said {
  private readonly lines: { at: number; text: string }[] = [];

  async install(context: BrowserContext): Promise<void> {
    await context.exposeBinding(BINDING, (source, lines: unknown) => {
      if (source.frame !== source.page.mainFrame() || !Array.isArray(lines)) return;
      for (const text of lines) if (typeof text === "string") this.add(text);
    });
    // tsx keeps function names with a `__name` helper the page doesn't have.
    await context.addInitScript({ content: `(() => { const __name = (f) => f; (${watch.toString()})(${JSON.stringify(BINDING)}, ${LINE_MAX}, ${EVERY_MS}); })();` });
  }

  /** A browser dialog says something too, and nobody is there to press OK. */
  watchDialogs(page: Page): void {
    page.on("dialog", (dialog) => {
      this.add(dialog.message().replace(/\s+/g, " ").trim().slice(0, LINE_MAX));
      void dialog.dismiss().catch(() => {});
    });
  }

  private add(text: string): void {
    if (!text) return;
    this.lines.push({ at: Date.now(), text });
    if (this.lines.length > KEPT) this.lines.splice(0, this.lines.length - KEPT);
  }

  /** The lines that appeared at or after a moment (Date.now()), oldest first. */
  since(at: number): string[] {
    return this.lines.filter((l) => l.at >= at).map((l) => l.text);
  }
}
