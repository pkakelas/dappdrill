/**
 * Compact accessibility snapshot of the page for the model: every visible
 * interactive element gets a stable ref (e1, e2…) the agent acts through, plus
 * headings, open dialogs and the page's key text, within a character budget.
 * The same DOM element keeps its ref across snapshots.
 *
 * `locatorFor()` turns a ref into a core Locator that survives re-renders and
 * cosmetic changes: testId > role+name > label > placeholder > text > css. One of several alike
 * ("Cancel" on each order) is named by the row it is in, before its place among them.
 */
import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "@dappdrill/core";
import { nearLocator } from "../replay/locators.js";
import { rowsHolding } from "../replay/rows.js";

export interface SnapshotNode {
  ref: string;
  role: string;
  name: string;
  value?: string;
  placeholder?: string;
  href?: string;
  disabled?: boolean;
  checked?: boolean | "mixed";
  expanded?: boolean;
  options?: string[];
  inDialog?: boolean;
  /** Entirely outside the viewport; dropped first when the snapshot is over budget. Not shown to the model. */
  offscreen?: boolean;
  /** In a long list (orders, history): which list, which row of it, and how many rows it has. Not shown to the model. */
  row?: { list: number; item: number; size: number };
  /** The rows of this node's list that aren't listed, after its last listed one. */
  more?: number;
}

export interface Snapshot {
  url: string;
  title: string;
  /** Names of open dialogs, first = topmost. */
  dialogs: string[];
  nodes: SnapshotNode[];
  /** Visible page text, whitespace-collapsed and truncated. */
  text: string;
}

/** Raw facts about one element, read in the page, used to derive a Locator. */
interface ElementFacts {
  tag: string;
  id?: string;
  testId?: string;
  role: string;
  name: string;
  label?: string;
  placeholder?: string;
  text?: string;
  /** The whole text of the smallest box around the element that has a little: its label in the layout. */
  near?: string;
  /** Words of the table row or list item the element is in, without figures: what could name that row ("Apple"). */
  rowWords: string[];
  inDialog: boolean;
  cssPath: string;
}

export const REF_ATTR = "data-dd-ref";
const DEFAULT_MAX_CHARS = 14_000;
const TEXT_CHARS = 2_000;
/** A list with this many alike rows is long: an account's orders, transfers or history. */
const LONG_LIST = 15;
/** The rows of a long list that are shown; the newest are usually first. */
const LIST_ROWS = 8;

/**
 * `wholeLists` keeps every row of a long list, for a check that may have to find this run's row
 * among many. A model finding its way gets the first rows and the ones on screen.
 */
export async function takeSnapshot(page: Page, opts: { maxChars?: number; wholeLists?: boolean } = {}): Promise<Snapshot> {
  await shimKeepNames(page);
  const listRows = opts.wholeLists ? Number.MAX_SAFE_INTEGER : LIST_ROWS;
  const raw = await page.evaluate(collectInPage, { refAttr: REF_ATTR, textChars: TEXT_CHARS, longList: LONG_LIST, listRows });
  const snap: Snapshot = { url: page.url(), title: await page.title().catch(() => ""), ...raw, nodes: opts.wholeLists ? raw.nodes : shortLists(raw.nodes) };
  return trim(snap, opts.maxChars ?? DEFAULT_MAX_CHARS);
}

export function formatSnapshot(snap: Snapshot): string {
  const lines: string[] = [`URL: ${snap.url}`, `Title: ${snap.title}`];
  if (snap.dialogs.length) lines.push(`Open dialog: ${snap.dialogs.join(" | ")}`);
  const dialogNodes = snap.nodes.filter((n) => n.inDialog);
  const pageNodes = snap.nodes.filter((n) => !n.inDialog);
  if (dialogNodes.length) {
    lines.push("", "Elements in the dialog:");
    for (const n of dialogNodes) lines.push(formatNode(n));
  }
  if (pageNodes.length) {
    lines.push("", dialogNodes.length ? "Elements behind the dialog:" : "Elements:");
    for (const n of pageNodes) lines.push(formatNode(n));
  }
  if (snap.text) lines.push("", "Page text:", snap.text);
  return lines.join("\n");
}

function formatNode(n: SnapshotNode): string {
  const flags: string[] = [];
  if (n.value !== undefined && n.value !== "") flags.push(`value="${n.value}"`);
  if (n.placeholder) flags.push(`placeholder="${n.placeholder}"`);
  if (n.href) flags.push(`href=${n.href}`);
  if (n.disabled) flags.push("disabled");
  if (n.checked !== undefined) flags.push(`checked=${n.checked}`);
  if (n.expanded !== undefined) flags.push(`expanded=${n.expanded}`);
  if (n.options) flags.push(`options=[${n.options.join(", ")}]`);
  const line = `[${n.ref}] ${n.role} "${n.name}"${flags.length ? " " + flags.join(" ") : ""}`;
  return n.more ? `${line}\n… ${n.more} more rows like these in this list, not listed: scroll down to see them` : line;
}

/**
 * A long list on the page keeps its first rows and the rows on screen. An account kept between runs
 * piles up orders and history, and listing all of them would leave no room for the rest of the page.
 * Lists in a dialog stay whole: a picker's options are what the dialog is for.
 */
export function shortLists(nodes: SnapshotNode[]): SnapshotNode[] {
  const out: SnapshotNode[] = [];
  const kept = new Map<number, Set<number>>();
  const last = new Map<number, SnapshotNode>();
  for (const n of nodes) {
    const row = n.inDialog ? undefined : n.row;
    if (row && row.item >= LIST_ROWS && n.offscreen) continue;
    out.push(n);
    if (!row) continue;
    kept.set(row.list, (kept.get(row.list) ?? new Set()).add(row.item));
    last.set(row.list, n);
  }
  return out.map((n) => {
    if (!n.row || last.get(n.row.list) !== n) return n;
    const more = n.row.size - Math.max(LIST_ROWS, kept.get(n.row.list)!.size);
    return more > 0 ? { ...n, more } : n;
  });
}

const FORM_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox", "listbox", "slider", "checkbox", "radio", "switch"]);

/** How much a node is worth keeping: on-screen beats off-screen, then form controls > buttons > links > headings. */
function keepScore(n: SnapshotNode): number {
  const tier = FORM_ROLES.has(n.role) ? 3 : n.role === "heading" ? 0 : n.role === "link" ? 1 : 2;
  return (n.offscreen ? 0 : 4) + tier;
}

/**
 * Drop lower-value nodes until the formatted snapshot fits the budget. Nodes
 * behind a dialog go before the dialog's own; among those the lowest score goes
 * first, from the end of the page. Ranking by position alone would drop an
 * on-screen side panel that comes after a long table in the DOM. What still
 * doesn't fit is cut off the page text, so the snapshot never goes over.
 */
function trim(snap: Snapshot, maxChars: number): Snapshot {
  let out: Snapshot = { ...snap, url: clipText(snap.url, 300), title: clipText(snap.title, 200) };
  let length = formatSnapshot(out).length;
  if (length <= maxChars) return out;
  out = { ...out, text: out.text.slice(0, 600) };
  length = formatSnapshot(out).length;
  // Each node is one line of the snapshot, so dropping it takes off that line (and a header with the last one).
  const order = out.nodes
    .map((n, i) => ({ i, dialog: n.inDialog ? 1 : 0, score: keepScore(n), chars: formatNode(n).length + 1 }))
    .sort((a, b) => a.dialog - b.dialog || a.score - b.score || b.i - a.i);
  const dropped = new Set<number>();
  for (const n of order) {
    if (length <= maxChars) break;
    dropped.add(n.i);
    length -= n.chars;
  }
  out = { ...out, nodes: out.nodes.filter((_, i) => !dropped.has(i)) };
  const over = formatSnapshot(out).length - maxChars;
  if (over > 0) out = { ...out, text: out.text.slice(0, Math.max(0, out.text.length - over)) };
  if (formatSnapshot(out).length > maxChars) out = { ...out, dialogs: out.dialogs.slice(0, 3) };
  return out;
}

function clipText(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Playwright locator for a ref from the latest snapshot. */
export function elementByRef(page: Page, ref: string): PwLocator {
  return page.locator(`[${REF_ATTR}="${ref}"]`).first();
}

/**
 * Derive a robust core Locator for the element behind `ref`. `rowTexts` are texts that name this run's
 * own rows (the price it typed), tried first when the element is one of several alike.
 */
export async function locatorFor(page: Page, ref: string, rowTexts: string[] = []): Promise<Locator> {
  await shimKeepNames(page);
  const facts = await page.evaluate(factsInPage, { refAttr: REF_ATTR, ref });
  if (!facts) throw new Error(`Unknown element ref ${ref}; take a fresh look`);
  const scope: PwLocator | Page = facts.inDialog ? page.getByRole("dialog").last() : page;
  const within = facts.inDialog ? { withinDialog: true as const } : {};

  const candidates: Array<{ loc: Locator; in: (scope: PwLocator | Page) => PwLocator }> = [];
  if (facts.testId) candidates.push({ loc: { testId: facts.testId }, in: (s) => s.getByTestId(facts.testId!) });
  if (facts.role && facts.name) {
    candidates.push({
      loc: { role: facts.role, name: facts.name },
      in: (s) => s.getByRole(facts.role as Parameters<Page["getByRole"]>[0], { name: facts.name, exact: true }),
    });
  }
  if (facts.label) candidates.push({ loc: { label: facts.label }, in: (s) => s.getByLabel(facts.label!, { exact: true }) });
  if (facts.placeholder) {
    candidates.push({ loc: { placeholder: facts.placeholder }, in: (s) => s.getByPlaceholder(facts.placeholder!, { exact: true }) });
  }
  if (facts.text) candidates.push({ loc: { text: facts.text }, in: (s) => s.getByText(facts.text!, { exact: true }) });

  // A field named only by its placeholder (two "0.00" boxes side by side), or an element with no name at
  // all, is also found by the box it sits in, when it is the only control of its kind there.
  const isControl = facts.tag === "input" || facts.tag === "textarea" || facts.tag === "select";
  const unnamed = isControl ? !facts.label && (!facts.name || facts.name === facts.placeholder) : !facts.name;
  const near = facts.near && unnamed ? facts.near : undefined;
  const nearPw = near ? nearLocator(scope, near, facts.role || undefined) : undefined;
  const inBox = nearPw && (await indexOfRef(nearPw, ref)) !== null && (await nearPw.count()) === 1 ? { near } : {};

  /** Our element as the only one of its name inside the one row that holds a text. */
  const several: typeof candidates = [];
  const inRow = async (): Promise<Locator | undefined> => {
    for (const text of [...rowTexts, ...facts.rowWords]) {
      const rows = rowsHolding(scope, text);
      if ((await rows.count()) !== 1) continue;
      for (const c of several) {
        const there = c.in(rows);
        if ((await there.count()) === 1 && (await indexOfRef(there, ref)) === 0) return { ...c.loc, row: text, ...within };
      }
    }
    return undefined;
  };

  for (const c of candidates) {
    const pw = c.in(scope);
    const idx = await indexOfRef(pw, ref);
    if (idx === null) continue;
    const locator: Locator = { ...c.loc, ...inBox, ...within };
    // Prefer a selector that matches uniquely; keep looking if this one needs more to say which.
    if ((await pw.count()) === 1) return locator;
    several.push(c);
    if (c !== candidates.at(-1)) continue;
    if (inBox.near) return locator;
    return (await inRow()) ?? { ...locator, nth: idx };
  }
  if (inBox.near) return { role: facts.role || undefined, ...inBox, ...within };
  const row = await inRow();
  if (row) return row;
  const css = facts.id && !looksGenerated(facts.id) ? `#${cssEscape(facts.id)}` : facts.cssPath;
  return { css, ...within };
}

/** Position of our element among the locator's matches, or null when absent. */
async function indexOfRef(pw: PwLocator, ref: string): Promise<number | null> {
  const idx = await pw.evaluateAll((els, { attr, ref }) => els.findIndex((e) => e.getAttribute(attr) === ref), {
    attr: REF_ATTR,
    ref,
  });
  return idx >= 0 ? idx : null;
}

function looksGenerated(id: string): boolean {
  return /^[:«»]|^(radix|headlessui|react|mui|chakra|mantine)-|\d{3,}|^[a-f0-9]{8,}$/i.test(id);
}

function cssEscape(s: string): string {
  return s.replace(/([^\w-])/g, "\\$1");
}

/**
 * tsx/esbuild wrap inner functions in a `__name()` helper that does not exist
 * in the page; define a no-op so the serialized functions below can run.
 */
function shimKeepNames(page: Page): Promise<void> {
  return page.evaluate("void (globalThis.__name ??= (f) => f)") as Promise<void>;
}

// ---------------------------------------------------------------- in-page code
// These run inside the browser via page.evaluate: no imports, no closures.

type RawSnapshot = Omit<Snapshot, "url" | "title">;

function collectInPage(args: { refAttr: string; textChars: number; longList: number; listRows: number }): RawSnapshot {
  const { refAttr, textChars, longList, listRows } = args;
  const w = window as unknown as { __ddSnap?: { refs: WeakMap<Element, string>; next: number } };
  const state = (w.__ddSnap ??= { refs: new WeakMap(), next: 1 });

  const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"]);
  const INTERACTIVE_ROLES = new Set([
    "button", "link", "checkbox", "radio", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
    "switch", "combobox", "textbox", "searchbox", "slider", "spinbutton", "listbox", "treeitem",
  ]);
  const LANDMARK_ROLES = new Set(["heading", "alert", "status", "dialog"]);

  const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const clip = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
  // What a person reads in an element: an icon's inline <style> is in textContent too.
  const readable = (el: Element | null | undefined): string => {
    if (!el) return "";
    if (!el.querySelector("style,script")) return text(el.textContent);
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll("style,script").forEach((c) => c.remove());
    return text(clone.textContent);
  };

  // Hidden subtrees are skipped entirely; a zero-size element is skipped itself
  // but its children may still render (fixed-position dialogs in an empty wrapper).
  // Apps also keep invisible copies of real UI for measuring, like Uniswap's wallet
  // list at opacity 1e-08 in a 1px box. Screen-reader-only controls have no children
  // here, so they stay listed.
  const hidden = (el: Element): boolean => {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) < 0.01) return true;
    if (style.overflow === "visible" || !el.children.length) return false;
    const box = el.getBoundingClientRect();
    return box.width <= 1 && box.height <= 1;
  };
  const hasBox = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const implicitRole = (el: Element): string => {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return el.hasAttribute("multiple") ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (type === "checkbox" || type === "radio") return type;
      if (type === "button" || type === "submit" || type === "reset" || type === "image") return "button";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      if (type === "hidden") return "";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "dialog") return "dialog";
    return "";
  };

  const roleOf = (el: Element): string => el.getAttribute("role")?.split(/\s+/)[0] ?? implicitRole(el);

  const labelText = (el: Element): string | undefined => {
    const id = el.getAttribute("id");
    if (id) {
      const root = el.getRootNode() as Document | ShadowRoot;
      const lab = root.querySelector?.(`label[for="${CSS.escape(id)}"]`);
      if (lab) return text(lab.textContent);
    }
    const wrap = el.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input,select,textarea,button").forEach((c) => c.remove());
      return text(clone.textContent) || undefined;
    }
    return undefined;
  };

  const byIdRefs = (el: Element, attr: string): string | undefined => {
    const ids = el.getAttribute(attr);
    if (!ids) return undefined;
    const root = el.getRootNode() as Document | ShadowRoot;
    const parts = ids.split(/\s+/).map((i) => text(root.getElementById?.(i)?.textContent ?? document.getElementById(i)?.textContent));
    return parts.filter(Boolean).join(" ") || undefined;
  };

  const accessibleName = (el: Element, role: string): string => {
    const explicit = byIdRefs(el, "aria-labelledby") ?? text(el.getAttribute("aria-label"));
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "select" || tag === "textarea") {
      const type = (el.getAttribute("type") ?? "").toLowerCase();
      if (type === "submit" || type === "button" || type === "reset") return text((el as HTMLInputElement).value) || "Submit";
      return labelText(el) ?? text(el.getAttribute("placeholder")) ?? text(el.getAttribute("title")) ?? text(el.getAttribute("name"));
    }
    const content = readable(el);
    if (content) return content;
    const img = el.querySelector("img[alt], svg[aria-label], [title]");
    const alt = img?.getAttribute("alt") ?? img?.getAttribute("aria-label") ?? img?.getAttribute("title");
    if (alt) return text(alt);
    if (role === "textbox") return text(el.getAttribute("placeholder"));
    return text(el.getAttribute("title"));
  };

  const hasInteractiveDescendant = (el: Element): boolean => {
    for (const c of el.querySelectorAll("*")) {
      if (INTERACTIVE_TAGS.has(c.tagName.toLowerCase()) || INTERACTIVE_ROLES.has(c.getAttribute("role") ?? "")) return true;
    }
    return false;
  };

  const isInteractive = (el: Element, role: string): boolean => {
    const tag = el.tagName.toLowerCase();
    if (INTERACTIVE_TAGS.has(tag)) return role !== "";
    if (INTERACTIVE_ROLES.has(role)) return true;
    if ((el as HTMLElement).isContentEditable) return true;
    const tabindex = el.getAttribute("tabindex");
    if (tabindex !== null && Number(tabindex) >= 0 && !hasInteractiveDescendant(el)) return true;
    // div-based buttons: pointer cursor, short text, no real controls inside.
    if (getComputedStyle(el).cursor === "pointer" && !hasInteractiveDescendant(el)) {
      const t = text(el.textContent);
      if (t) return t.length <= 60;
      // Icon-only controls (custom checkboxes, close icons): small, and where the cursor is set, not a child inheriting it.
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      return r.width <= 48 && r.height <= 48 && (!parent || getComputedStyle(parent).cursor !== "pointer");
    }
    return false;
  };

  /** Text of the closest ancestor that has some, to name an unlabeled icon control. */
  const nearbyText = (el: Element): { text: string; container: Element } | null => {
    let p = el.parentElement;
    for (let i = 0; p && i < 3; i++, p = p.parentElement) {
      const t = text(p.textContent);
      if (t) return { text: t, container: p };
    }
    return null;
  };

  /** An icon in the top-right corner of its container is, almost always, that container's close button. */
  const unlabeledName = (el: Element): string => {
    const near = nearbyText(el);
    if (!near) return "";
    const r = el.getBoundingClientRect();
    const c = near.container.getBoundingClientRect();
    const corner = c.width > 4 * r.width && c.right - r.right < 48 && r.top - c.top < 48;
    return corner ? `unlabeled icon in the top-right corner of "${clip(near.text, 50)}"` : `unlabeled, next to "${clip(near.text, 60)}"`;
  };

  // Long lists: a box with many children alike (same tag and class) is a list, and each of them a row.
  type List = { id: number; sig: string; items: Element[] };
  const lists = new Map<Element, List | null>();
  const sig = (e: Element) => `${e.tagName}.${e.getAttribute("class") ?? ""}`;
  const listOf = (box: Element): List | null => {
    if (lists.has(box)) return lists.get(box)!;
    let list: List | null = null;
    if (box.children.length >= longList) {
      const counts = new Map<string, number>();
      for (const k of box.children) counts.set(sig(k), (counts.get(sig(k)) ?? 0) + 1);
      const [top, n] = [...counts].reduce((a, b) => (b[1] > a[1] ? b : a));
      if (n >= longList) list = { id: lists.size + 1, sig: top, items: Array.from(box.children).filter((k) => sig(k) === top) };
    }
    lists.set(box, list);
    return list;
  };
  const rowOf = (el: Element): SnapshotNode["row"] => {
    let e: Element | null = el;
    for (let depth = 0; e?.parentElement && depth < 10; depth++, e = e.parentElement) {
      const list = listOf(e.parentElement);
      if (list && sig(e) === list.sig) return { list: list.id, item: list.items.indexOf(e), size: list.items.length };
    }
    return undefined;
  };

  const refFor = (el: Element): string => {
    let ref = state.refs.get(el);
    if (!ref) {
      ref = `e${state.next++}`;
      state.refs.set(el, ref);
    }
    el.setAttribute(refAttr, ref);
    return ref;
  };

  // Walk the DOM, descending into open shadow roots.
  const dialogs: Element[] = [];
  const nodes: SnapshotNode[] = [];
  const seen = new Set<Element>();

  // `inControl`: inside a button, where the text is already in its name. Only real controls are
  // listed there: a row that is itself a button, with Modify and Cancel buttons in it.
  const walk = (root: Document | ShadowRoot | Element, dialog: Element | null, inControl = false) => {
    const children = root instanceof Element && root.shadowRoot ? [root.shadowRoot] : [];
    const kids = root instanceof ShadowRoot || root instanceof Document ? Array.from(root.children) : Array.from((root as Element).children);
    for (const child of [...children, ...kids]) {
      if (child instanceof ShadowRoot) {
        // A component's own tree is read in full, as it was before: its host is often the "button".
        walk(child, dialog);
        continue;
      }
      const el = child as Element;
      if (seen.has(el)) continue;
      seen.add(el);
      const tag = el.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "noscript" || tag === "template") continue;
      if (el.getAttribute("aria-hidden") === "true" || hidden(el)) continue;

      const role = roleOf(el);
      let inDialog = dialog;
      const isDialog = role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true";
      if (isDialog && hasBox(el)) {
        dialogs.push(el);
        inDialog = el;
      }

      const listed = inControl ? role !== "" && (INTERACTIVE_TAGS.has(tag) || INTERACTIVE_ROLES.has(role)) : isInteractive(el, role) || (LANDMARK_ROLES.has(role) && !isDialog);
      if (hasBox(el) && listed) {
        const name = accessibleName(el, role) || (role ? "" : unlabeledName(el));
        const node: SnapshotNode = { ref: refFor(el), role: role || "generic", name: clip(name, 90) };
        if (inDialog) node.inDialog = true;
        const row = rowOf(el);
        if (row) node.row = row;
        const box = el.getBoundingClientRect();
        if (box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) node.offscreen = true;
        if (tag === "input" || tag === "textarea") {
          const input = el as HTMLInputElement;
          if (input.type !== "checkbox" && input.type !== "radio" && input.type !== "password") node.value = clip(input.value, 60);
          else if (input.type !== "password") node.checked = input.indeterminate ? "mixed" : input.checked;
          const ph = text(input.placeholder);
          if (ph && ph !== node.name) node.placeholder = clip(ph, 80);
        } else if (tag === "select") {
          const sel = el as HTMLSelectElement;
          node.value = clip(sel.selectedOptions[0]?.textContent ?? "", 60);
          node.options = Array.from(sel.options).slice(0, 20).map((o) => clip(text(o.textContent), 40));
        } else if ((el as HTMLElement).isContentEditable) {
          node.value = clip(text(el.textContent), 60);
        }
        const checked = el.getAttribute("aria-checked") ?? el.getAttribute("aria-pressed") ?? el.getAttribute("aria-selected");
        if (checked !== null && node.checked === undefined) node.checked = checked === "mixed" ? "mixed" : checked === "true";
        const expanded = el.getAttribute("aria-expanded");
        if (expanded !== null) node.expanded = expanded === "true";
        if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") node.disabled = true;
        if (tag === "a") {
          const href = el.getAttribute("href") ?? "";
          if (href && !href.startsWith("#") && !href.startsWith("javascript:")) node.href = clip(href, 80);
        }
        nodes.push(node);
      }
      walk(el, inDialog, inControl || (INTERACTIVE_TAGS.has(tag) && tag !== "a") || (role === "button" && !isDialog));
    }
  };
  walk(document, null);

  const openDialogs = dialogs.filter((d) => d.getAttribute("aria-hidden") !== "true");
  const topDialog = openDialogs.at(-1);
  const source = (topDialog ?? document.body) as HTMLElement;
  // The page's text with the rows of its long lists after the first few taken out, the way the elements are.
  let full = source.innerText;
  if (!topDialog) {
    for (const box of source.querySelectorAll("*")) if (box.children.length >= longList) listOf(box);
    for (const list of lists.values()) {
      if (!list || list.items.length <= listRows) continue;
      const rest = list.items.slice(listRows);
      // Search after the last row kept, so a row that reads the same as a kept one isn't taken out in its place.
      const kept = (list.items[listRows - 1] as HTMLElement).innerText ?? "";
      const keptAt = kept.trim() ? full.indexOf(kept) : -1;
      const start = keptAt < 0 ? 0 : keptAt + kept.length;
      let from = -1;
      for (const item of rest) {
        const t = (item as HTMLElement).innerText ?? "";
        if (!t.trim()) continue;
        const at = full.indexOf(t, from < 0 ? start : from);
        if (at < 0) continue;
        const mark = from < 0 ? `\n… ${rest.length} more rows like these\n` : "";
        full = full.slice(0, at) + mark + full.slice(at + t.length);
        if (from < 0) from = at + mark.length;
      }
    }
  }
  const pageText = clip(text(full), textChars);

  return {
    dialogs: openDialogs.map((d) => clip(text(d.getAttribute("aria-label") ?? d.querySelector("h1,h2,h3,[role=heading]")?.textContent ?? "dialog"), 60)).reverse(),
    nodes,
    text: pageText,
  };
}

function factsInPage(args: { refAttr: string; ref: string }): ElementFacts | null {
  const el = document.querySelector(`[${args.refAttr}="${args.ref}"]`) ?? findInShadow(document, args.refAttr, args.ref);
  if (!el) return null;

  function findInShadow(root: Document | ShadowRoot | Element, attr: string, ref: string): Element | null {
    for (const c of root.querySelectorAll("*")) {
      if (c.shadowRoot) {
        const hit = c.shadowRoot.querySelector(`[${attr}="${ref}"]`) ?? findInShadow(c.shadowRoot, attr, ref);
        if (hit) return hit;
      }
    }
    return null;
  }
  const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const readable = (e: Element): string => {
    if (!e.querySelector("style,script")) return text(e.textContent);
    const clone = e.cloneNode(true) as Element;
    clone.querySelectorAll("style,script").forEach((c) => c.remove());
    return text(clone.textContent);
  };
  const tag = el.tagName.toLowerCase();

  const implicitRole = (): string => {
    const type = (el.getAttribute("type") ?? "text").toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return el.hasAttribute("multiple") ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (type === "checkbox" || type === "radio") return type;
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return "";
  };
  const role = el.getAttribute("role")?.split(/\s+/)[0] ?? implicitRole();

  const labelFor = (): string | undefined => {
    const id = el.getAttribute("id");
    const root = el.getRootNode() as Document | ShadowRoot;
    if (id) {
      const lab = root.querySelector?.(`label[for="${CSS.escape(id)}"]`);
      if (lab) return text(lab.textContent) || undefined;
    }
    const wrap = el.closest("label");
    if (wrap) {
      const clone = wrap.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input,select,textarea,button").forEach((c) => c.remove());
      return text(clone.textContent) || undefined;
    }
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy.split(/\s+/).map((i) => text(document.getElementById(i)?.textContent)).filter(Boolean).join(" ");
      if (t) return t;
    }
    return text(el.getAttribute("aria-label")) || undefined;
  };

  const isControl = tag === "input" || tag === "select" || tag === "textarea";
  const label = isControl ? labelFor() : undefined;
  const ariaName = text(el.getAttribute("aria-label"));
  const content = readable(el);
  const name = ariaName || (isControl ? label ?? text(el.getAttribute("placeholder")) : content || text(el.querySelector("img[alt]")?.getAttribute("alt")));
  const ownText = !isControl && content && content.length <= 80 ? content : undefined;

  // Up to the box that says what the element is for ("Price", "Amount Max"), stopping before a box that says more than that.
  const nearText = (): string | undefined => {
    let p = el.parentElement;
    for (let i = 0; p && p !== document.body && i < 5; i++, p = p.parentElement) {
      const t = readable(p);
      if (t.length > 48) return undefined;
      if (t && t !== content) return t;
    }
    return undefined;
  };

  // The words of its row that aren't figures and aren't its own: one of them may name the row among the others.
  const rowWords = (): string[] => {
    const row = el.closest('tr, li, [role="row"], [role="listitem"]');
    if (!row) return [];
    const words = [...row.querySelectorAll("*")]
      .filter((e) => !e.children.length && !el.contains(e) && !e.closest("button, a, [role=button]"))
      .map((e) => text(e.textContent))
      .filter((t) => t.length >= 2 && t.length <= 40 && !/\d/.test(t));
    return [...new Set(words)].slice(0, 6);
  };

  const cssPath = (): string => {
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== document.body && parts.length < 8) {
      const t = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((s) => s.tagName === cur!.tagName);
      parts.unshift(siblings.length > 1 ? `${t}:nth-of-type(${siblings.indexOf(cur) + 1})` : t);
      cur = parent;
    }
    return parts.join(" > ");
  };

  return {
    tag,
    id: el.getAttribute("id") ?? undefined,
    testId: el.getAttribute("data-testid") ?? undefined,
    role,
    name: name.length > 80 ? "" : name,
    label,
    placeholder: text(el.getAttribute("placeholder")) || undefined,
    text: ownText,
    near: nearText(),
    rowWords: rowWords(),
    inDialog: !!el.closest("[role=dialog],[role=alertdialog],dialog[open],[aria-modal=true]"),
    cssPath: cssPath(),
  };
}
