/**
 * Rows: a line of a table or a list, found by a text it holds ("287.40", "Apple"). Recordings click
 * inside one ("Cancel" on the order priced 287.40) and checks read inside one, so neither depends on
 * where the row stands today. Rows are a Playwright selector engine, `row="text"`, so they are looked
 * for again on every try like any other locator.
 */
import { selectors, type Locator as PwLocator, type Page } from "playwright";

/**
 * In the page: no imports, no closures. A row is, for the innermost visible element that holds the text:
 * the table row or list item it is in; else the lowest element around it that has nothing beside it while
 * something inside it does (cells side by side); else the lowest element that holds more than the text and
 * is stacked above or below its siblings. Anything much taller than the text is no row.
 */
function rowEngine() {
  const SEMANTIC = 'tr, li, [role="row"], [role="listitem"]';
  const MAX_HEIGHT_PX = 200;
  const flat = (s: string) => s.replace(/\s+/g, "").replace(/(\d),(?=\d{3})/g, "$1").toLowerCase();
  const seen = (el: Element) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (el as HTMLElement).checkVisibility?.() !== false;
  };
  const siblings = (el: Element) => [...(el.parentElement?.children ?? [])].filter((s) => s !== el && seen(s));
  const beside = (el: Element) => {
    const a = el.getBoundingClientRect();
    return siblings(el).some((s) => {
      const b = s.getBoundingClientRect();
      const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      return shared > Math.min(a.height, b.height) / 2 && (b.left >= a.right - 1 || b.right <= a.left + 1);
    });
  };
  const stacked = (el: Element) => {
    const a = el.getBoundingClientRect();
    return !beside(el) && siblings(el).some((s) => s.getBoundingClientRect().top >= a.bottom - 1 || s.getBoundingClientRect().bottom <= a.top + 1);
  };
  const all = (root: Element | Document, selector: string): Element[] => {
    const want = flat(String(JSON.parse(selector)));
    const scope = root.nodeType === 9 ? (root as Document).body : (root as Element);
    const holds = (el: Element) => flat(el.textContent ?? "").includes(want);
    if (!want || !scope || !holds(scope)) return [];
    const innermost: Element[] = [];
    const walk = (el: Element) => {
      let deeper = false;
      for (const child of el.children) {
        if (!holds(child)) continue;
        deeper = true;
        walk(child);
      }
      if (!deeper && seen(el)) innermost.push(el);
    };
    walk(scope);
    const rows = new Set<Element>();
    for (const m of innermost) {
      const semantic = m.closest(SEMANTIC);
      if (semantic && scope.contains(semantic) && semantic !== scope) {
        rows.add(semantic);
        continue;
      }
      const fits = (el: Element) => el.getBoundingClientRect().height <= Math.max(MAX_HEIGHT_PX, m.getBoundingClientRect().height * 8);
      const above: Element[] = [];
      for (let a = m.parentElement; a && a !== scope && a !== document.body; a = a.parentElement) above.push(a);
      let cells = beside(m);
      let row = above.find((a) => {
        if (cells && !beside(a)) return true;
        cells ||= beside(a);
        return false;
      });
      if (!row || !fits(row)) row = [m, ...above].find((a) => flat(a.textContent ?? "").replace(want, "").replace(/[^a-z0-9]/g, "").length > 1 && stacked(a));
      if (row && fits(row)) rows.add(row);
    }
    return [...rows];
  };
  return { query: (root: Element | Document, selector: string) => all(root, selector)[0] ?? null, queryAll: all };
}

// tsx keeps function names with a `__name` helper the page doesn't have. Registered once for every browser of this process.
void selectors.register("row", { content: `(() => { const __name = (f) => f; return (${rowEngine.toString()})(); })()` }).catch((e: unknown) => {
  if (!String(e).includes("already registered")) throw e;
});

/** The rows inside `scope` that hold the text: none, one, or several when the text isn't the row's own. */
export function rowsHolding(scope: Page | PwLocator, text: string): PwLocator {
  return scope.locator(`row=${JSON.stringify(text)}`);
}

/** A table read down one column: each row's cell under the heading, top to bottom. */
export type Column = { cells: string[] } | { missing: string };

/**
 * In the page: the cells under a column heading. The heading stands in a line of cells, and a row of the
 * table is a line with as many cells: the next lines beside the heading's, or those of the block after it
 * (a table's head and body). With `row` given, only that row's cell. A table with its headings and no rows reads as empty.
 */
function columnInPage(root: Element, args: { heading: string; rowText?: string }): Column {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const tight = (s: string) => s.replace(/\s+/g, "").replace(/(\d),(?=\d{3})/g, "$1").toLowerCase();
  const seen = (el: Element) => el.getBoundingClientRect().height > 0 && (el as HTMLElement).checkVisibility?.() !== false;
  const want = flat(args.heading);
  const headings = [...root.querySelectorAll("*")].filter((el) => seen(el) && flat(el.textContent ?? "") === want && ![...el.children].some((c) => flat(c.textContent ?? "") === want));
  if (!headings.length) return { missing: `No column headed “${args.heading}” on the page.` };
  let empty = false;
  for (const h of headings) {
    let lined = false;
    // The heading's own cell, then the line it is in: no further up than a few wrappers.
    for (let cell: Element = h, line = h.parentElement, up = 0; line && line !== root.parentElement && up < 4 && !lined; cell = line, line = line.parentElement, up++) {
      const n = line.children.length;
      const like = (el: Element) => el !== line && el.tagName === line!.tagName && el.children.length === n && seen(el);
      const after = (el: Element) => {
        const out: Element[] = [];
        for (let s = el.nextElementSibling; s; s = s.nextElementSibling) out.push(s);
        return out;
      };
      const next = n < 2 ? [] : after(line).filter(like);
      const lines = next.length || n < 2 || !line.parentElement ? next : after(line.parentElement).flatMap((block) => [...block.children].filter(like));
      if (!lines.length) continue;
      lined = true;
      const at = [...line.children].indexOf(cell);
      const rows = args.rowText === undefined ? lines : lines.filter((l) => tight(l.textContent ?? "").includes(tight(args.rowText!)));
      if (rows.length) return { cells: rows.map((l) => (l.children[at] as HTMLElement).innerText ?? "") };
    }
    // The headings of a table that has no rows, or none with the text.
    if (lined || h.closest('th, [role="columnheader"]')) empty = true;
  }
  return empty ? { cells: [] } : { missing: `No rows line up under the heading “${args.heading}”.` };
}

/** The cells under a column heading inside `scope`: every row's, or only those of the rows that hold `rowText`. */
export async function readColumn(scope: PwLocator, heading: string, rowText?: string): Promise<Column> {
  await scope.page().evaluate("void (globalThis.__name ??= (f) => f)");
  return scope.first().evaluate(columnInPage, { heading, rowText });
}
