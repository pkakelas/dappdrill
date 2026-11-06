/**
 * Compact accessibility snapshot of the page for the model: every visible
 * interactive element gets a stable ref (e1, e2…) the agent acts through, plus
 * headings, open dialogs and the page's key text, within a character budget.
 * The same DOM element keeps its ref across snapshots.
 *
 * `locatorFor()` turns a ref into a core Locator that survives re-renders and
 * cosmetic changes: testId > role+name > label > placeholder > text > css.
 */
import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "@dappdrill/core";

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
  inDialog: boolean;
  cssPath: string;
}

export const REF_ATTR = "data-dd-ref";
const DEFAULT_MAX_CHARS = 14_000;
const TEXT_CHARS = 2_000;

export async function takeSnapshot(page: Page, opts: { maxChars?: number } = {}): Promise<Snapshot> {
  await shimKeepNames(page);
  const raw = await page.evaluate(collectInPage, { refAttr: REF_ATTR, textChars: TEXT_CHARS });
  const snap: Snapshot = { url: page.url(), title: await page.title().catch(() => ""), ...raw };
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
  return `[${n.ref}] ${n.role} "${n.name}"${flags.length ? " " + flags.join(" ") : ""}`;
}

const FORM_ROLES = new Set(["textbox", "searchbox", "spinbutton", "combobox", "listbox", "slider", "checkbox", "radio", "switch"]);

/** How much a node is worth keeping: on-screen beats off-screen, then form controls > buttons > links > headings. */
function keepScore(n: SnapshotNode): number {
  const tier = FORM_ROLES.has(n.role) ? 3 : n.role === "heading" ? 0 : n.role === "link" ? 1 : 2;
  return (n.offscreen ? 0 : 4) + tier;
}

/**
 * Drop lower-value nodes until the formatted snapshot fits the budget. Dialog
 * nodes stay; among the rest the lowest score goes first, from the end of the
 * page. Ranking by position alone would drop an on-screen side panel that
 * comes after a long table in the DOM.
 */
function trim(snap: Snapshot, maxChars: number): Snapshot {
  let out = snap;
  if (formatSnapshot(out).length <= maxChars) return out;
  out = { ...out, text: out.text.slice(0, 600) };
  let nodes = out.nodes;
  while (formatSnapshot({ ...out, nodes }).length > maxChars && nodes.length > 10) {
    let drop = -1;
    for (let i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i]!.inDialog) continue;
      if (drop < 0 || keepScore(nodes[i]!) < keepScore(nodes[drop]!)) drop = i;
    }
    if (drop < 0) break;
    nodes = nodes.filter((_, i) => i !== drop);
  }
  return { ...out, nodes };
}

/** Playwright locator for a ref from the latest snapshot. */
export function elementByRef(page: Page, ref: string): PwLocator {
  return page.locator(`[${REF_ATTR}="${ref}"]`).first();
}

/** Derive a robust core Locator for the element behind `ref`. */
export async function locatorFor(page: Page, ref: string): Promise<Locator> {
  await shimKeepNames(page);
  const facts = await page.evaluate(factsInPage, { refAttr: REF_ATTR, ref });
  if (!facts) throw new Error(`Unknown element ref ${ref}; take a fresh look`);
  const scope: PwLocator | Page = facts.inDialog ? page.getByRole("dialog").last() : page;
  const within = facts.inDialog ? { withinDialog: true as const } : {};

  const candidates: Array<{ loc: Locator; pw: PwLocator }> = [];
  if (facts.testId) candidates.push({ loc: { testId: facts.testId }, pw: scope.getByTestId(facts.testId) });
  if (facts.role && facts.name) {
    candidates.push({
      loc: { role: facts.role, name: facts.name },
      pw: scope.getByRole(facts.role as Parameters<Page["getByRole"]>[0], { name: facts.name, exact: true }),
    });
  }
  if (facts.label) candidates.push({ loc: { label: facts.label }, pw: scope.getByLabel(facts.label, { exact: true }) });
  if (facts.placeholder) {
    candidates.push({ loc: { placeholder: facts.placeholder }, pw: scope.getByPlaceholder(facts.placeholder, { exact: true }) });
  }
  if (facts.text) candidates.push({ loc: { text: facts.text }, pw: scope.getByText(facts.text, { exact: true }) });

  for (const c of candidates) {
    const idx = await indexOfRef(c.pw, ref);
    if (idx === null) continue;
    const count = await c.pw.count();
    const locator: Locator = { ...c.loc, ...within };
    if (count > 1) locator.nth = idx;
    // Prefer a selector that matches uniquely; keep looking if this one needs nth.
    if (count === 1) return locator;
    if (c === candidates.at(-1)) return locator;
  }
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

function collectInPage(args: { refAttr: string; textChars: number }): RawSnapshot {
  const { refAttr, textChars } = args;
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

  const walk = (root: Document | ShadowRoot | Element, dialog: Element | null) => {
    const children = root instanceof Element && root.shadowRoot ? [root.shadowRoot] : [];
    const kids = root instanceof ShadowRoot || root instanceof Document ? Array.from(root.children) : Array.from((root as Element).children);
    for (const child of [...children, ...kids]) {
      if (child instanceof ShadowRoot) {
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

      if (hasBox(el) && (isInteractive(el, role) || (LANDMARK_ROLES.has(role) && !isDialog))) {
        const name = accessibleName(el, role) || (role ? "" : unlabeledName(el));
        const node: SnapshotNode = { ref: refFor(el), role: role || "generic", name: clip(name, 90) };
        if (inDialog) node.inDialog = true;
        const box = el.getBoundingClientRect();
        if (box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth) node.offscreen = true;
        if (tag === "input" || tag === "textarea") {
          const input = el as HTMLInputElement;
          if (input.type !== "checkbox" && input.type !== "radio" && input.type !== "password") node.value = clip(input.value, 60);
          else if (input.type !== "password") node.checked = input.indeterminate ? "mixed" : input.checked;
          const ph = text(input.placeholder);
          if (ph && ph !== node.name) node.placeholder = ph;
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
      // Don't descend into controls; their text is already in the name.
      if (!(INTERACTIVE_TAGS.has(tag) && tag !== "a") && !(role === "button" && !isDialog)) walk(el, inDialog);
      else if (el.shadowRoot) walk(el.shadowRoot, inDialog);
    }
  };
  walk(document, null);

  const openDialogs = dialogs.filter((d) => d.getAttribute("aria-hidden") !== "true");
  const topDialog = openDialogs.at(-1);
  const source = (topDialog ?? document.body) as HTMLElement;
  const pageText = clip(text(source.innerText), textChars);

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
    inDialog: !!el.closest("[role=dialog],[role=alertdialog],dialog[open],[aria-modal=true]"),
    cssPath: cssPath(),
  };
}
