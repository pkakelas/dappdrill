# DappDrill design system

The web app's look and the pieces it is built from. It follows the marketing site
(`../dappdrill-site`): warm paper, near-black ink, Newsreader for reading, IBM Plex Mono for
controls, and pill buttons.

- **Tokens and CSS components:** `apps/web/src/app/globals.css`
- **React components:** `apps/web/src/components/ui/`. Import them from `@/components/ui`.
- **Living reference:** `/design` in the running app. Every specimen there is the real
  component, and the account menu links to it in dev mode.

A new page should be put together from these pieces. If you find yourself writing
`text-[13px]` or a hand-built flex stack for a row, there is probably a class or
component for it already. Add to the system rather than around it.

## Principles

1. **Paper and ink.** Use Newsreader for anything people read. Use Plex Mono for anything they
   press or scan: buttons, labels, tags, addresses, code.
2. **Only problems get colour.**
   - Broken is red and Review is amber.
   - OK and passes stay grey, so the eye lands on what's wrong.
3. **Blue means running.** Live blue marks work in progress (a running scan, a queued batch),
   never a result, a link or a highlight. Changed lines in a steps diff use `bg-sub`, not blue.
4. **Say it plainly.**
   - Statuses are Broken / Review / OK.
   - Signing verdicts are Dangerous / Check this / Looks consistent, never "safe".
   - No "AI" badges, no gradients. "Simulate" only means transaction simulation.
5. **One shape per job.**
   - Rows are `List` + `ListRow`.
   - Sections are `Section`.
   - Callouts are `Notice`.
   - Empty states are `Empty` (a page or tab) or `Blank` (inside a section).
6. **Every action answers.**
   - Submit buttons show they're working.
   - Destructive actions arm on the first click and run on the second (`ConfirmButton`), with no modals.
   - Detail opens in the side panel, not a new page.

## Tokens

### Colour

Use token utilities such as `bg-sub`, `text-bad` and `border-line-strong`. Never write hex values in components.

| Group | Tokens | Use |
|---|---|---|
| Ink | `ink` `ink-2` `ink-3` `muted` `faint` `quiet` | Text, darkest to lightest. Body text is `ink`, secondary text is `ink-3` or `muted`, placeholders are `faint`. |
| Paper | `paper` `card` `sub` `hair` `bone` | `paper` is the page, `card` is containers, `sub` is hover and quiet fills, `hair` is quiet pills and tracks. |
| Lines | `divide` `line` `line-strong` `field` | `divide` goes between rows inside a card, `line` around quiet things, `line-strong` around cards and buttons. |
| Broken | `bad` `bad-bg` `bad-soft` `bad-line` `bad-ink` | Failures, critical/high issues, Dangerous, armed destructive buttons. |
| Review | `warn` `warn-bg` `warn-soft` `warn-line` `warn-ink` `warn-bar` | Medium issues, Check this, "Needs a fix", unverified domains, paused integrations. |
| Live | `live` `live-ink` `live-bg` `live-soft` `live-line` | Running or queued. Nothing else. |
| Diff | `diff-del` `diff-add` | Removed and added lines on the dark code block. |

### Type

Use the class, not a pixel size.

| Class | Size | Use |
|---|---|---|
| `.h1` | 34 → 44px serif | Page title, one per page |
| `.h1-sm` | 32px serif | Title inside a card (auth, dialogs) |
| `.title` | 24px serif | Side panel and critical-issue titles |
| `.h2` | 22px serif | Section heading |
| `.h3` | 19px serif | Settings, card and sub-section headings |
| `.lead` | 17px | The status line under a page title |
| `text-body` | 15px | Reading text, table cells, list row titles |
| `.meta` | 13px muted | Row meta, timestamps |
| `.hint` | 14px muted | Help under a control or section |
| `.label` | 11px mono caps | Field labels, table headers |
| `.eyebrow` | 11px mono caps with a rule | A kicker above a heading |
| `.crumbs` | 11px mono caps | Breadcrumbs |
| `text-2xs` | 10.5px | Tags, pills, stat labels |

Weights stay light. The serif never goes above ~540 (`font-semibold` is remapped).

### Spacing, radius, shadow

- `.page`: a 1080px column with 36px (`gap-9`) between sections, and 12px inside a `Section`.
- Radii:
  - Cards, lists and notices: `rounded-xl` (14px).
  - Fields: `rounded-lg`.
  - Buttons, chips and pills: `rounded-full`.
  - Tags: 5px.
- Only floating things cast shadows:
  - `shadow-pop` for popovers and menus.
  - `shadow-panel` for the side panel.
  - `shadow-bar` for the sticky save bar.

## CSS components (`globals.css`)

| Class | What |
|---|---|
| `.btn` `.btn-primary` `.btn-danger` | Pill buttons in mono. One primary per view. `.btn-danger` stays quiet until hovered, then goes solid red when armed (`data-armed`). |
| `.btn-lg` `.btn-sm` `.btn-xs` `.btn-icon` `.btn-link` | Sizes: `lg` for a page's main action, `sm` inside cards, `xs` inside rows. `.btn-link` is a text action in mono. |
| `.card` `.popover` `.codeblock` `.skeleton` | Surfaces. |
| `.notice` `.notice-bad/-warn/-live` | Callouts (use `Notice`). |
| `.list` `.row` `.row-link` | Bordered list with divided rows (use `List` / `ListRow`). |
| `.table` `.stretched` | Data tables. Put `.stretched` on a row's main link to make the whole row clickable. Buttons in the row stay clickable. |
| `.field` `.field-sm` `.field-lg` `.check` | Inputs. `aria-invalid` turns the border red. |
| `.chip` | Toggle pill. Filled when checked (use `Chip`). |
| `.seg` | Segmented control for tabs, filters and either/or choices. Marks the current item with `aria-current` or `aria-pressed`; `.count` holds a number. |
| `.pill` `.tag` `.tag-lg` | Status shapes. A tag names a result; a pill describes a thing. |
| `.param` | A `{{input}}` inside a step. |
| `.live-dot` | Pulsing blue dot. |

## React components (`components/ui`)

### Layout (`layout.tsx`)

- `PageHeader({ crumbs, title, status, sub, actions, children })`
  - Every page starts with it.
  - `status` sits under the title, for a HealthBadge or a run state.
  - `children` sits below, for tabs or a section nav.
- `Section({ id, title, hint, action })` is an h2 section. The `action` is usually a `.btn-link`.
- `SettingsSection({ id, title, hint })` is the two-column settings block.
  - It renders the anchor `#{id}-section`.
- `List({ ordered })` and `ListRow({ href, title, meta, aside, current })`.
  - With `href`, the whole row is a link.
- `Empty({ title, action })` is for a page or tab with nothing in it. Say why, and what to do next.
- `Blank` is a one-line "nothing here" inside a section.
- `Notice({ tone, title, action, role })` is a callout. Tone is `neutral`, `bad`, `warn` or `live`.
- `Disclosure({ summary, aside })` is a collapsible card for logs, calldata and setup snippets.
- `Reveal({ label })` is an inline "Show 3 more…".
- `StatGrid`, `Meter` and `Facts` show numbers, usage against a limit, and label/value pairs.
- `Crumbs` renders breadcrumbs.

### Status (`status.tsx`)

- `HealthBadge` covers an app, scan or run: Broken / Review / OK.
- `SeverityTag` covers an issue: Critical / High / Medium / Low.
- `VerdictTag` covers a signature request: Dangerous / Check this / Looks consistent.
- `JobStatus` follows a scan or batch over its life:
  - Queued or Running in live blue.
  - Then its HealthBadge.
  - Failed and Stopped are quiet.
- `RunState` gives a flow's latest result in words: Passed / Failed / Needs a fix / Not run yet.
- `Sparkbars` and `SparkLegend` show the last N runs.
- `Cell` is a matrix cell.
- `Pill` holds quiet labels (Baseline, Unverified, Read-only).
- `Mono` and `Addr` render code and shortened addresses with the full value in a tooltip.
- `LiveDot` is the pulsing dot.

### Forms (`forms.tsx`, `client.tsx`)

- `Field({ label, hint, error, aside })` wraps a control: label above, hint or error below.
- `Checkbox` and `Chip` are the toggles. `Hidden({ fields })` holds the hidden inputs.
- `SubmitButton({ pendingText })` disables itself and shows progress while its form's action runs.
- `ActionButton({ action, fields, confirm })` is one server action as one button.
  - It puts the hidden fields, the pending state and an optional confirm in a single element.
  - Use it for Run, Archive, Revoke, Remove, and similar actions.
- `ConfirmButton({ confirm })` arms on the first click ("Archive it?") and submits on the second. It disarms after 4s or on blur.
- `FormMessage({ state })` is the error or success line under a form (`role=alert` / `status`).
- `Popover({ label, button, menu })` is a floating panel for short forms and menus. It closes on Escape and on an outside click. Menus also close when an item is chosen.
- `ActionForm` (`components/action-form.tsx`) is a form bound to a `useActionState` server action. It shows its message and any one-time secret.

### Icons (`icons.tsx`)

`Logo`, `PlayIcon`, `ArrowIcon`, `ChevronIcon`, `CheckIcon`, `CloseIcon`, `PlusIcon`, `ExternalIcon`.

They are inline SVG with a 1.5px stroke in `currentColor`, plus `cx()` for joining class names.

## Patterns

- **Page:**
  - `.page` → `PageHeader` → `Section`s.
  - Settings pages use `SettingsSection` with a `.seg` anchor nav in the header.
- **Detail:** issues, runs and signature reviews open in the right-hand side panel (`?panel=`).
  - The panel's actions sit in its sticky footer.
  - Escape closes it, and focus returns to what opened it.
- **Destructive actions:** use `ActionButton confirm="Archive it?"`. Don't use modals or `window.confirm`.
- **Loading:**
  - Route-level `loading.tsx` shows a skeleton in the page's shape.
  - Buttons show pending text.
  - Live work shows `JobStatus` or a live `Notice`.
- **Errors:**
  - `FormMessage` goes under forms.
  - A `Notice tone="bad"` is for a failed scan or batch.
  - `error.tsx` covers a page that throws, and `not-found.tsx` covers bad links.
- **Empty:** say what will be here and give the next step as a button.
- **Lists vs tables:**
  - Use a `List` for a handful of things with one line of meta each.
  - Use a `.table` when people compare columns (flows, runs).

## What changed in this pass

The audit that produced this system found the problems below. Each one is fixed across every page.

- **One-off sizes and colours.**
  - Hand-written `text-[13px]` and `text-[15px]` sizes became tokens (`text-meta`, `text-body`, `.meta`, `.hint`).
- **Rebuilt structure on every page.**
  - Each page had its own header, section and row markup.
  - Pages now share `PageHeader`, `Section`, `List`/`ListRow`, `Empty` and `Blank`.
- **Silent buttons.**
  - Server-action buttons gave no feedback.
  - Every submit now shows pending state through `SubmitButton` or `ActionButton`.
- **Unguarded destructive actions.**
  - These ran on the first click: archive flow, remove variation, stop run, stop scan, revoke token, remove member, cancel invite, remove domain, disconnect integration, remove inbox, turn off sharing.
  - They now confirm on a second click.
- **`<details>` used as menus.**
  - Schedule and Share became `Popover`s that close on Escape and on an outside click.
- **Side panel.**
  - Actions moved into a sticky footer.
  - Focus moves into the panel on open and returns to the opener on close.
- **Signing review.**
  - The actions (accept as baseline, mark expected, open issue) moved up next to the verdict.
  - Passed checks and raw calldata collapse.
- **Blue used for non-progress.**
  - Changed steps in a diff, chain pills and `{{params}}` are now neutral.
- **Quota in the header bar.**
  - Moved into the account menu, which keeps the bar for navigation.
- **Whole-row links.**
  - Rows in the flows, runs and issue lists are clickable across their full width.
  - Buttons inside them still work.
- **Empty states.**
  - Overview, Flows, Runs, a flow's runs tab and the share page each explain themselves and offer the next step.
- **Account page.**
  - Added a section nav, `Meter` for usage, a warn pill for unverified domains and paused integrations, and clearer verification steps.
- **Auth.**
  - One `AuthCard` for login, signup, reset and invite, with field hints and inline errors.
- **Missing route states.**
  - Added `loading.tsx` (skeleton), `error.tsx` and `not-found.tsx`.
