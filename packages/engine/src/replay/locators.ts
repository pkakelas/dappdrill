/**
 * Turn a core Locator into a Playwright locator. Candidates are tried in the
 * order the Locator schema documents (testId, role+name exact then loose,
 * label, placeholder, text, css) until one matches a visible element, polling
 * until the timeout so slow pages still work.
 */
import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "@dappdrill/core";

type Scope = Page | PwLocator;

export async function resolveLocator(page: Page, loc: Locator, timeoutMs: number): Promise<PwLocator> {
  const deadline = Date.now() + timeoutMs;
  const tried: string[] = [];
  do {
    const scope = loc.withinDialog ? await dialogScope(page) : page;
    if (scope) {
      for (const { name, build } of candidates(scope, loc)) {
        if (!tried.includes(name)) tried.push(name);
        const visible = build().filter({ visible: true });
        const count = await visible.count().catch(() => 0);
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

function candidates(scope: Scope, loc: Locator): { name: string; build: () => PwLocator }[] {
  const out: { name: string; build: () => PwLocator }[] = [];
  if (loc.testId) out.push({ name: `testId "${loc.testId}"`, build: () => scope.getByTestId(loc.testId!) });
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
  return out;
}

/** The topmost open dialog, or undefined when none is open yet. */
async function dialogScope(page: Page): Promise<PwLocator | undefined> {
  const dialogs = page.locator('[role="dialog"], dialog[open], [role="alertdialog"]').filter({ visible: true });
  const n = await dialogs.count().catch(() => 0);
  return n > 0 ? dialogs.nth(n - 1) : undefined;
}

export function describeLocator(loc: Locator): string {
  const parts: string[] = [];
  if (loc.testId) parts.push(`testId=${loc.testId}`);
  if (loc.role) parts.push(`role=${loc.role}`);
  if (loc.name) parts.push(`name="${loc.name}"`);
  if (loc.label) parts.push(`label="${loc.label}"`);
  if (loc.placeholder) parts.push(`placeholder="${loc.placeholder}"`);
  if (loc.text) parts.push(`text="${loc.text}"`);
  if (loc.css) parts.push(`css=${loc.css}`);
  if (loc.withinDialog) parts.push("in dialog");
  return parts.join(" ") || "element";
}
