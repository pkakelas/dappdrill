/**
 * Turn a core Locator into a Playwright locator. Candidates are tried in the
 * order the Locator schema documents (testId, the control in the box `near` names,
 * role+name exact then loose, label, placeholder, text, css) until one matches a
 * visible element, polling until the timeout so slow pages still work.
 */
import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "@dappdrill/core";

type Scope = Page | PwLocator;

export async function resolveLocator(page: Page, loc: Locator, timeoutMs: number): Promise<PwLocator> {
  const deadline = Date.now() + timeoutMs;
  const tried: string[] = [];
  do {
    const scope = loc.withinDialog ? await openDialog(page) : page;
    if (scope) {
      for (const { name, build, loose } of candidates(scope, loc)) {
        if (!tried.includes(name)) tried.push(name);
        const visible = build().filter({ visible: true });
        const count = await visible.count().catch(() => 0);
        // A loose match that fits several rows can't say which one was meant.
        if (loose && count > 1 && loc.nth === undefined) continue;
        if (count > 0) return visible.nth(loc.nth ?? 0);
        if (loc.nth !== undefined && loc.nth > 0) {
          const any = build();
          if ((await any.count().catch(() => 0)) > loc.nth) return any.nth(loc.nth);
        }
      }
    } else tried.push("dialog");
    await page.waitForTimeout(200);
  } while (Date.now() < deadline);
  throw new Error(`Could not find ${describeLocator(loc)} (tried ${tried.join(", ")})`);
}

function candidates(scope: Scope, loc: Locator): { name: string; build: () => PwLocator; loose?: boolean }[] {
  const out: { name: string; build: () => PwLocator; loose?: boolean }[] = [];
  if (loc.testId) out.push({ name: `testId "${loc.testId}"`, build: () => scope.getByTestId(loc.testId!) });
  if (loc.near) {
    // The box the element sits in tells two fields with the same placeholder apart; with several controls in it, the name must say which.
    if (loc.role && loc.name) out.push({ name: `${loc.role} "${loc.name}" in "${loc.near}"`, loose: true, build: () => nearLocator(scope, loc.near!, loc.role, loc.name) });
    out.push({ name: `${loc.role ?? "control"} in "${loc.near}"`, loose: true, build: () => nearLocator(scope, loc.near!, loc.role) });
  }
  if (loc.role && loc.name) {
    const role = loc.role as Parameters<Page["getByRole"]>[0];
    out.push({ name: `${loc.role} "${loc.name}"`, build: () => scope.getByRole(role, { name: loc.name, exact: true }) });
    out.push({ name: `${loc.role} ~"${loc.name}"`, build: () => scope.getByRole(role, { name: loc.name }) });
  } else if (loc.role) {
    out.push({ name: `role ${loc.role}`, build: () => scope.getByRole(loc.role as Parameters<Page["getByRole"]>[0]) });
  } else if (loc.name) {
    out.push({ name: `button "${loc.name}"`, build: () => scope.getByRole("button", { name: loc.name, exact: true }) });
    out.push({ name: `link "${loc.name}"`, build: () => scope.getByRole("link", { name: loc.name, exact: true }) });
    out.push({ name: `text "${loc.name}"`, build: () => scope.getByText(loc.name!, { exact: true }) });
  }
  if (loc.label) {
    out.push({ name: `label "${loc.label}"`, build: () => scope.getByLabel(loc.label!, { exact: true }) });
    out.push({ name: `label ~"${loc.label}"`, build: () => scope.getByLabel(loc.label!) });
  }
  if (loc.placeholder) {
    out.push({ name: `placeholder "${loc.placeholder}"`, build: () => scope.getByPlaceholder(loc.placeholder!, { exact: true }) });
    out.push({ name: `placeholder ~"${loc.placeholder}"`, build: () => scope.getByPlaceholder(loc.placeholder!) });
  }
  if (loc.text) {
    out.push({ name: `text "${loc.text}"`, build: () => scope.getByText(loc.text!, { exact: true }) });
    out.push({ name: `text ~"${loc.text}"`, build: () => scope.getByText(loc.text!) });
  }
  if (loc.css) out.push({ name: `css ${loc.css}`, build: () => scope.locator(loc.css!) });
  // Last, the same words around other figures: a row named by a live quote reads differently on the next run.
  const named = loc.role && loc.name ? anyFigures(loc.name) : undefined;
  if (named) out.push({ name: `${loc.role} "${loc.name}" with other figures`, loose: true, build: () => scope.getByRole(loc.role as Parameters<Page["getByRole"]>[0], { name: named }) });
  const worded = loc.text ? anyFigures(loc.text) : undefined;
  if (worded) out.push({ name: `text "${loc.text}" with other figures`, loose: true, build: () => scope.getByText(worded) });
  return out;
}

/** Elements that hold a field and the words beside it. */
const BOXES = "div, section, article, aside, li, dl, dd, fieldset, form, label, p, tr, td, th, header, footer, main";
const CONTROLS = "input, textarea, select, [contenteditable=true], [contenteditable='']";

/**
 * The control inside the box whose whole text is `near` ("Price", "Amount Max"), the same way the
 * recorder found it. A figure in the words takes any figure, since a balance shown beside a field moves.
 */
export function nearLocator(scope: Scope, near: string, role?: string, name?: string): PwLocator {
  const box = scope.locator(BOXES).filter({ hasText: wording(near) });
  if (role) return box.getByRole(role as Parameters<Page["getByRole"]>[0], name ? { name, exact: true } : {});
  return box.locator(CONTROLS);
}

const FIGURE = /\d[\d,]*\.\d+/g;
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
const pattern = (words: string[]) => new RegExp(`^\\s*${words.map(literal).join("[\\d,.]+")}\\s*$`);

/** The whole text, with any figure where one was recorded. */
export function wording(text: string): RegExp {
  return pattern(text.split(FIGURE));
}

/**
 * A name that holds a live figure ("0.01 ETH 22.223 USDC In progress") as a pattern that takes any
 * figure in its place. Only numbers with a decimal point count: "25%" and "Page 2" are labels.
 */
export function anyFigures(text: string): RegExp | undefined {
  const words = text.split(FIGURE);
  if (words.length < 2 || words.join("").replace(/[^a-z]/gi, "").length < 3) return undefined;
  return pattern(words);
}

/**
 * The topmost open dialog, or undefined when none is open yet. Some dialogs (Privy's sign-in) are
 * a wrapper with no height around fixed-position content, so one with anything visible inside counts.
 */
export async function openDialog(page: Page): Promise<PwLocator | undefined> {
  const dialogs = page.locator('[role="dialog"], dialog[open], [role="alertdialog"], [aria-modal="true"]');
  const n = await dialogs.count().catch(() => 0);
  for (let i = n - 1; i >= 0; i--) {
    const dialog = dialogs.nth(i);
    if (await dialog.isVisible().catch(() => false)) return dialog;
    if ((await dialog.locator(":visible").first().count().catch(() => 0)) > 0) return dialog;
  }
  return undefined;
}

export function describeLocator(loc: Locator): string {
  const parts: string[] = [];
  if (loc.testId) parts.push(`testId=${loc.testId}`);
  if (loc.role) parts.push(`role=${loc.role}`);
  if (loc.name) parts.push(`name="${loc.name}"`);
  if (loc.label) parts.push(`label="${loc.label}"`);
  if (loc.placeholder) parts.push(`placeholder="${loc.placeholder}"`);
  if (loc.text) parts.push(`text="${loc.text}"`);
  if (loc.near) parts.push(`in "${loc.near}"`);
  if (loc.css) parts.push(`css=${loc.css}`);
  if (loc.withinDialog) parts.push("in dialog");
  return parts.join(" ") || "element";
}
