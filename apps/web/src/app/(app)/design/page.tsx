import type { Health, RunStatus, Severity, Verdict } from "@dappdrill/core";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CopyButton } from "@/components/report/copy-button";
import {
  ActionButton,
  Addr,
  ArrowIcon,
  Blank,
  Cell,
  CheckIcon,
  Checkbox,
  ChevronIcon,
  Chip,
  CloseIcon,
  ConfirmButton,
  Disclosure,
  Empty,
  ExternalIcon,
  Facts,
  Field,
  FormMessage,
  HealthBadge,
  JobStatus,
  List,
  ListRow,
  LiveDot,
  Logo,
  Meter,
  Mono,
  Notice,
  PageHeader,
  Pill,
  PlayIcon,
  PlusIcon,
  Popover,
  Reveal,
  RunState,
  Section,
  SettingsSection,
  SeverityTag,
  Sparkbars,
  SparkLegend,
  StatGrid,
  SubmitButton,
  VerdictTag,
  type CellKind,
} from "@/components/ui";

export const metadata: Metadata = { title: "Design system" };

/* The living reference for components/ui and the tokens in globals.css.
 * Every specimen here is the real component; if it looks wrong here, it looks
 * wrong in the product. Written up in docs/design-system.md. */

async function noop() {
  "use server";
}

const SECTIONS = ["Principles", "Colour", "Type", "Buttons", "Forms", "Status", "Surfaces", "Lists", "Layout", "Feedback", "Icons"] as const;

const COLOURS: { group: string; note: string; tokens: string[] }[] = [
  { group: "Ink", note: "Text, darkest to lightest. Body is ink; secondary is ink-3 or muted.", tokens: ["ink", "ink-2", "ink-3", "muted", "faint", "quiet"] },
  { group: "Paper", note: "Page, cards and quiet fills.", tokens: ["paper", "card", "sub", "hair", "bone"] },
  { group: "Lines", note: "divide inside cards, line around quiet things, line-strong around cards and buttons.", tokens: ["divide", "line", "line-strong"] },
  { group: "Broken", note: "The only loud colour. Failures, critical issues, Dangerous.", tokens: ["bad", "bad-bg", "bad-soft", "bad-line", "bad-ink"] },
  { group: "Review", note: "Needs a look: issues, Check this, a flow that needs a fix.", tokens: ["warn", "warn-bg", "warn-soft", "warn-line", "warn-ink", "warn-bar"] },
  { group: "Live", note: "Still running. Never a result.", tokens: ["live", "live-ink", "live-bg", "live-soft", "live-line"] },
];

const TYPE: { cls: string; sample: string; use: string }[] = [
  { cls: "h1", sample: "Harbor Vault has 2 broken flows", use: "Page title. One per page." },
  { cls: "h1-sm", sample: "Log in", use: "Title inside a card (auth, dialogs)." },
  { cls: "title", sample: "Deposit reverts with 0 balance", use: "Side panel and critical-issue titles." },
  { cls: "h2", sample: "Open issues", use: "Section heading." },
  { cls: "h3", sample: "Test wallets", use: "Settings and card headings." },
  { cls: "lead", sample: "Last scan 2 hours ago found 3 problems in 14 flows.", use: "The status line under a page title." },
  { cls: "text-body", sample: "Body copy and table cells. 15px Newsreader.", use: "Default reading size." },
  { cls: "meta", sample: "Created 3 days ago · last used yesterday", use: "Row meta, timestamps, secondary detail." },
  { cls: "hint", sample: "Replays are always unlimited. Only discovery scans count.", use: "Help text under a control or section." },
  { cls: "label", sample: "Repository", use: "Field labels, table headers. Mono caps." },
  { cls: "eyebrow", sample: "Signing review", use: "A kicker above a heading, as on the site." },
  { cls: "crumbs", sample: "Flows / Deposit and withdraw", use: "Breadcrumbs." },
];

const HEALTH: Health[] = ["broken", "review", "ok"];
const SEVERITY: Severity[] = ["critical", "high", "medium", "low"];
const VERDICT: Verdict[] = ["dangerous", "check", "consistent"];
const CELLS: CellKind[] = ["pass", "issue", "issue-high", "signing", "fail", "error", "running", "queued", "skipped"];
const RUNS: RunStatus[] = ["pass", "pass", "issue", "pass", "fail", "pass", "pass", "skipped", "pass"];

export default function DesignPage() {
  return (
    <div className="page">
      <PageHeader
        crumbs={[{ label: "Account", href: "/account" }, { label: "Design system" }]}
        title="Design system"
        sub={
          <>
            Tokens live in <Mono>app/globals.css</Mono>, components in <Mono>components/ui</Mono>. Every specimen is the real component. The rules are in <Mono>docs/design-system.md</Mono>.
          </>
        }
      >
        <nav className="seg mt-3" aria-label="Design system sections">
          {SECTIONS.map((s) => (
            <a key={s} href={`#${s.toLowerCase()}`}>
              {s}
            </a>
          ))}
        </nav>
      </PageHeader>

      <Section id="principles" title="Principles">
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ["Paper and ink", "Warm paper, near-black ink, hairline rules. Newsreader for anything you read; Plex Mono for anything you press or scan (buttons, labels, addresses)."],
            ["Only problems get colour", "Broken is red, Review is amber, OK is grey. Passing things stay quiet so the eye lands on what's wrong."],
            ["Blue means running", "Live blue marks work in progress (a scan, a queued run) and nothing else. Never a result, never a link."],
            ["Say it plainly", "Status words are Broken / Review / OK. Signing verdicts are Dangerous / Check this / Looks consistent, never “safe”. No AI badges, no gradients."],
            ["One shape per job", "Lists are List + ListRow, sections are Section, callouts are Notice. A new page should be assembled, not styled."],
            ["Every action answers", "Buttons show they're working (SubmitButton). Destructive ones ask with a second click (ConfirmButton), not a modal."],
          ].map(([t, d]) => (
            <div key={t} className="card flex flex-col gap-1.5 p-5">
              <h3 className="h3">{t}</h3>
              <p className="meta m-0 leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section id="colour" title="Colour" hint="Use tokens (bg-sub, text-bad, border-line-strong), never hex.">
        <div className="flex flex-col gap-5">
          {COLOURS.map((g) => (
            <div key={g.group} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="label">{g.group}</span>
                <span className="meta">{g.note}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {g.tokens.map((t) => (
                  <div key={t} className="flex flex-col gap-1.5">
                    <span className="h-12 rounded-lg border border-line" style={{ background: `var(--color-${t})` }} />
                    <Mono className="text-2xs text-muted">{t}</Mono>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Type" hint="Use the class, not a pixel size. Mono runs small on purpose: it labels, it doesn't read.">
        <List>
          {TYPE.map((t) => (
            <li key={t.cls} className="row items-baseline">
              <span className="flex min-w-0 flex-[1_1_420px] flex-col gap-1">
                <span className={t.cls}>{t.sample}</span>
              </span>
              <span className="flex w-[240px] flex-col gap-0.5">
                <Mono className="text-meta">.{t.cls}</Mono>
                <span className="meta">{t.use}</span>
              </span>
            </li>
          ))}
        </List>
      </Section>

      <Section id="buttons" title="Buttons" hint="Pills in mono. One primary per view. Sizes: lg for the page's main action, default, sm in cards, xs in rows.">
        <Specimens>
          <Specimen name=".btn-primary · .btn · .btn-danger">
            <button className="btn btn-primary">
              <PlayIcon /> Run all
            </button>
            <button className="btn">Duplicate</button>
            <button className="btn btn-danger">Archive</button>
            <button className="btn" disabled>
              Disabled
            </button>
          </Specimen>
          <Specimen name="Sizes: .btn-lg · default · .btn-sm · .btn-xs · .btn-icon">
            <button className="btn btn-primary btn-lg">Start scan</button>
            <button className="btn">Run</button>
            <button className="btn btn-sm">Manage</button>
            <button className="btn btn-xs">Revoke</button>
            <button className="btn btn-icon" aria-label="Close">
              <CloseIcon />
            </button>
          </Specimen>
          <Specimen name=".btn-link">
            <a href="#buttons" className="btn-link">
              See all runs <ArrowIcon />
            </a>
          </Specimen>
          <Specimen name="SubmitButton · ActionButton (pending state)">
            <form action={noop}>
              <SubmitButton className="btn-primary" pendingText="Starting…">
                Submit me
              </SubmitButton>
            </form>
            <ActionButton action={noop} pendingText="Queuing…">
              Run
            </ActionButton>
          </Specimen>
          <Specimen name="ConfirmButton / ActionButton confirm (click twice)">
            <ActionButton action={noop} confirm="Archive it?">
              Archive
            </ActionButton>
            <form action={noop}>
              <ConfirmButton className="btn-xs" confirm="Remove?">
                Remove
              </ConfirmButton>
            </form>
          </Specimen>
          <Specimen name="CopyButton · Popover">
            <CopyButton text="0x5FbDB2315678afecb367f032d93F642f64180aa3" label="Copy address" />
            <Popover label="Schedule" button={<>Schedule <ChevronIcon /></>} buttonClassName="btn btn-sm">
              <p className="meta m-0">Popovers hold short forms and menus. Escape or an outside click closes them.</p>
            </Popover>
          </Specimen>
        </Specimens>
      </Section>

      <Section id="forms" title="Forms" hint="Label above, hint or error below. Errors go in FormMessage after the fields, and the field gets aria-invalid.">
        <div className="card grid gap-5 p-5 sm:grid-cols-2">
          <Field label="dApp URL" hint="A preview deploy works best.">
            <input className="field font-mono" placeholder="https://app.example.com" />
          </Field>
          <Field label="Email" error="That isn't an email address.">
            <input className="field" defaultValue="alice@" aria-invalid />
          </Field>
          <Field label="Notes for the explorer" aside={<span className="meta">Optional</span>}>
            <textarea className="field" rows={3} placeholder="Log in with the test account, then try a deposit." />
          </Field>
          <div className="flex flex-col gap-3">
            <span className="label">Checkbox · Chip</span>
            <Checkbox label="Also test on a second account" description="Uses Test account B." defaultChecked />
            <div className="flex flex-wrap gap-2">
              <Chip defaultChecked>Ethereum</Chip>
              <Chip>Base</Chip>
              <Chip>Arbitrum</Chip>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="label">.field-sm (dense editors)</span>
            <input className="field field-sm" defaultValue="click 'Deposit'" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="label">.seg (tabs, filters, either/or)</span>
            <nav className="seg">
              <a href="#forms" aria-current="page">
                Steps
              </a>
              <a href="#forms">
                Runs<span className="count">12</span>
              </a>
              <a href="#forms">Code</a>
            </nav>
          </div>
          <div className="sm:col-span-2">
            <FormMessage state={{ error: "Couldn't reach https://app.example.com (timed out after 30s)." }} />
            <FormMessage state={{ ok: "Saved. The next scheduled run uses it." }} />
          </div>
        </div>
      </Section>

      <Section id="status" title="Status" hint="Three result words. Tags are square-ish and name a result; pills are round and describe a thing.">
        <Specimens>
          <Specimen name="HealthBadge (an app, a scan, a run)">
            {HEALTH.map((h) => (
              <HealthBadge key={h} health={h} />
            ))}
            <HealthBadge health="broken" large />
          </Specimen>
          <Specimen name="SeverityTag (an issue)">
            {SEVERITY.map((s) => (
              <SeverityTag key={s} severity={s} />
            ))}
          </Specimen>
          <Specimen name="VerdictTag (a signature request)">
            {VERDICT.map((v) => (
              <VerdictTag key={v} verdict={v} />
            ))}
          </Specimen>
          <Specimen name="JobStatus (a scan or batch over its life)">
            <JobStatus status="queued" />
            <JobStatus status="running" />
            <JobStatus status="done" health="review" />
            <JobStatus status="failed" />
            <JobStatus status="stopped" />
          </Specimen>
          <Specimen name="Pill (quiet labels)">
            <Pill>Baseline</Pill>
            <Pill>Unverified</Pill>
            <Pill tone="warn">Not verified</Pill>
            <Pill tone="bad">Reverted</Pill>
            <Pill tone="live">
              <LiveDot className="size-1.5" /> Running
            </Pill>
          </Specimen>
          <Specimen name="Cell (matrix and run outcomes)">
            {CELLS.map((c) => (
              <Cell key={c} kind={c} />
            ))}
          </Specimen>
          <Specimen name="RunState · Sparkbars (a flow's latest and recent runs)">
            <RunState status="pass" />
            <RunState status="fail" />
            <RunState needsFix />
            <RunState />
            <Sparkbars statuses={RUNS} />
          </Specimen>
          <div className="row">
            <SparkLegend />
          </div>
        </Specimens>
      </Section>

      <Section id="surfaces" title="Surfaces">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card p-5">
            <p className="label m-0">.card</p>
            <p className="meta mt-1 mb-0">The default container. Paper-light fill, strong hairline.</p>
          </div>
          <div className="popover p-5">
            <p className="label m-0">.popover</p>
            <p className="meta mt-1 mb-0">Floating panels: menus, popovers. The only thing with a shadow, besides the side panel.</p>
          </div>
          <pre className="codeblock m-0 sm:col-span-2">{`await page.getByRole("button", { name: "Deposit" }).click();\nawait wallet.approve();`}</pre>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-4 w-1/2" />
            <span className="meta">.skeleton: loading placeholders (see app/(app)/loading.tsx).</span>
          </div>
        </div>
      </Section>

      <Section id="lists" title="Lists" hint="Rows of things are List + ListRow. With href, the whole row is the link. Tables use .table, with .stretched on the row's main link.">
        <List>
          <ListRow href="#lists" title="Deposit and withdraw" meta="Last run 2 hours ago · 3 min" aside={<Sparkbars statuses={RUNS} />} />
          <ListRow href="#lists" title="Scan #14" meta="Yesterday · 14 flows" aside={<JobStatus status="done" health="broken" />} current />
          <ListRow title="Test account A" meta={<Addr value="0x5FbDB2315678afecb367f032d93F642f64180aa3" chars={6} />} aside={<button className="btn btn-xs">Copy</button>} />
        </List>
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Flow</th>
                <th>Latest</th>
                <th>Last 10</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <a href="#lists" className="stretched no-underline">
                    Deposit and withdraw
                  </a>
                </td>
                <td>
                  <RunState status="fail" />
                </td>
                <td>
                  <Sparkbars statuses={RUNS} />
                </td>
                <td className="text-right">
                  <button className="btn btn-xs">Run</button>
                </td>
              </tr>
              <tr>
                <td>
                  <a href="#lists" className="stretched no-underline">
                    Connect wallet
                  </a>
                </td>
                <td>
                  <RunState status="pass" />
                </td>
                <td>
                  <Sparkbars statuses={["pass", "pass", "pass"]} />
                </td>
                <td className="text-right">
                  <button className="btn btn-xs">Run</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <Facts
          className="card p-5"
          items={[
            ["Expected", "Balance goes up by 1.0 ETH"],
            ["Actual", "Balance unchanged; the transaction reverted"],
            ["Facts", "Label / value pairs: decoded arguments, expected vs actual."],
          ]}
        />
      </Section>

      <Section id="layout" title="Layout" hint="Every page is .page (1080px, 36px between sections) → PageHeader → Sections. Settings pages use SettingsSection.">
        <div className="card flex flex-col gap-6 p-5">
          <PageHeader
            crumbs={[{ label: "Flows", href: "#layout" }, { label: "Deposit and withdraw" }]}
            title="Deposit and withdraw"
            status={
              <div className="flex items-center gap-3">
                <RunState status="fail" /> <span className="meta">2 hours ago</span>
              </div>
            }
            sub="7 steps · runs daily at 09:00"
            actions={
              <>
                <button className="btn">Duplicate</button>
                <button className="btn btn-primary">
                  <PlayIcon /> Run
                </button>
              </>
            }
          />
          <Section title="A Section" hint="h2, an optional hint, an action on the right." action={<a className="btn-link">See all</a>}>
            <Blank>Blank: a one-line “nothing here” inside a section.</Blank>
          </Section>
        </div>
        <div className="card px-5">
          <SettingsSection id="specimen" title="SettingsSection" hint="Title and hint on the left, controls on the right. Used on Account.">
            <StatGrid
              size="sm"
              stats={[
                { value: 14, label: "Flows" },
                { value: 2, label: "Broken", tone: "bad" },
                { value: 1, label: "To review", tone: "warn" },
                { value: 31, label: "Edge cases" },
              ]}
            />
            <div className="grid gap-5 sm:grid-cols-3">
              <Meter label="Discovery scans" value="3 of 5" fill={0.6} />
              <Meter label="At the limit" value="5 of 5" fill={1} />
              <Meter label="Replays this month" value={128} />
            </div>
          </SettingsSection>
        </div>
      </Section>

      <Section id="feedback" title="Feedback" hint="Notices are callouts. Tinted only for problems (bad, warn) and work in progress (live).">
        <Notice title="Neutral" action={<button className="btn btn-sm">Action</button>}>
          Context that isn&apos;t a problem: a reason a run was skipped, where to find something.
        </Notice>
        <Notice tone="live" title="Scan #15 is running" action={<button className="btn btn-sm">Watch it live</button>}>
          8 of 14 flows explored.
        </Notice>
        <Notice tone="warn" title="This flow needs a fix">
          The Deposit button moved. A repaired version is ready to review.
        </Notice>
        <Notice tone="bad" title="The scan failed" role="alert">
          The dApp didn&apos;t load: https://app.example.com returned 502.
        </Notice>
        <Empty title="No flows yet" action={<button className="btn btn-primary">Start a scan</button>}>
          Empty: a page or tab with nothing in it. Say why, and what to do next.
        </Empty>
        <Disclosure summary="Console log" aside="42 lines">
          <pre className="codeblock m-0 rounded-none">{`[warn] Missing chainId in eth_sendTransaction\n[error] execution reverted: insufficient allowance`}</pre>
        </Disclosure>
        <Reveal label="Show 3 low-severity issues">
          <Blank>Reveal: more of the same list, inline.</Blank>
        </Reveal>
      </Section>

      <Section id="icons" title="Icons" hint="Inline SVG, 1.5px stroke, currentColor. Add new ones to components/ui/icons.tsx.">
        <div className="card flex flex-wrap items-center gap-6 p-5 text-ink-2">
          {(
            [
              ["Logo", <Logo key="l" />],
              ["Play", <PlayIcon key="p" />],
              ["Arrow", <ArrowIcon key="a" />],
              ["Chevron", <ChevronIcon key="c" />],
              ["Check", <CheckIcon key="k" />],
              ["Close", <CloseIcon key="x" />],
              ["Plus", <PlusIcon key="+" />],
              ["External", <ExternalIcon key="e" />],
            ] as [string, ReactNode][]
          ).map(([n, i]) => (
            <span key={n} className="flex flex-col items-center gap-2">
              {i}
              <Mono className="text-2xs text-muted">{n}</Mono>
            </span>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Specimens({ children }: { children: ReactNode }) {
  return <div className="list">{children}</div>;
}

function Specimen({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4">
      <Mono className="text-2xs tracking-[0.06em] text-muted">{name}</Mono>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
