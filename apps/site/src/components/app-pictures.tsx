import type { ReactNode } from "react";
import { HarborVault, Wallet } from "./exhibits";

/*
 * DappDrill's own pages, drawn after apps/web so they stay sharp and scale with the page (styles in
 * app/app.css). The app under test is Harbor Vault (fixtures/harbor-vault) and the bugs are its seeded ones.
 * Signing review is left out on purpose: the site is about QA.
 */

/** Lucide icons, as paths on a 24 grid. */
const ICON = {
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  plus: ["M5 12h14", "M12 5v14"],
  play: ["M6 3v18l14-9z"],
  arrowUpRight: ["M7 7h10v10", "M7 17 17 7"],
  upDown: ["m7 15 5 5 5-5", "m7 9 5-5 5 5"],
  chevronRight: ["m9 18 6-6-6-6"],
  chevronDown: ["m6 9 6 6 6-6"],
  compass: ["M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20", "m16.24 7.76-1.8 5.41a2 2 0 0 1-1.27 1.27L7.76 16.24l1.8-5.41a2 2 0 0 1 1.27-1.27z"],
  listChecks: ["m3 17 2 2 4-4", "m3 7 2 2 4-4", "M13 6h8", "M13 12h8", "M13 18h8"],
  bug: ["m8 2 1.88 1.88", "M14.12 3.88 16 2", "M9 7.13v-1a3 3 0 1 1 6 0v1", "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6", "M12 20v-9", "M6.53 9C4.6 8.8 3 7.1 3 5", "M6 13H2", "M3 21c0-2.1 1.7-3.9 3.8-4", "M20.97 5c0 2.1-1.6 3.8-3.5 4", "M22 13h-4", "M17.2 17c2.1.1 3.8 1.9 3.8 4"],
  fork: ["M12 15a3 3 0 1 0 0 6 3 3 0 1 0 0-6", "M6 3a3 3 0 1 0 0 6 3 3 0 1 0 0-6", "M18 3a3 3 0 1 0 0 6 3 3 0 1 0 0-6", "M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9", "M12 12v3"],
  scan: ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6", "m16 16-1.9-1.9"],
  circleCheck: ["M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20", "m9 12 2 2 4-4"],
  circleX: ["M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20", "m15 9-6 6", "m9 9 6 6"],
  lock: ["M5 11h14v10H5z", "M7 11V7a5 5 0 0 1 10 0v4"],
  wallet: ["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1", "M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],
} as const;

function I({ name, size }: { name: keyof typeof ICON; size?: "sm" | "xs" }) {
  return (
    <svg viewBox="0 0 24 24" className={size ? `i ${size}` : "i"}>
      {ICON[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const Logo = () => (
  <svg viewBox="0 0 20 20" className="logo">
    <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill="var(--color-red)" />
  </svg>
);

/** The app's window: its bar, with the organization, the app and the page's tab. */
function Window({ label, tab = "Tests", children }: { label: string; tab?: string; children: ReactNode }) {
  return (
    <div className="dd-wrap" role="img" aria-label={label}>
      <div className="dd" aria-hidden="true">
        <div className="dd-win">
          <div className="dd-dots">
            <i />
            <i />
            <i />
          </div>
          <div className="dd-bar">
            <Logo />
            <b>DappDrill</b>
            <span className="dd-pick">
              <span>Harbor Labs</span>
              <I name="upDown" />
            </span>
            <span className="dd-slash">/</span>
            <span className="dd-pick" style={{ marginLeft: 0 }}>
              <span>Harbor Vault</span>
              <I name="upDown" />
            </span>
            <div className="dd-nav">
              {["Tests", "Runs", "Settings"].map((t) => (
                <span key={t} className={t === tab ? "on" : undefined}>
                  {t}
                </span>
              ))}
            </div>
            <div className="dd-avatar">
              <span>H</span>
            </div>
          </div>
          <div className="dd-page">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** A browser window inside the app, showing Harbor Vault. `width` is the window's width in the picture's em. */
function Site({ width, state, overlay, children }: { width: number; state: "idle" | "wallet" | "stuck"; overlay?: ReactNode; children?: ReactNode }) {
  return (
    <div className="dd-frame">
      <div className="dd-scale" style={{ fontSize: `${width / 94}em` }}>
        <HarborVault state={state}>{children}</HarborVault>
      </div>
      {overlay}
    </div>
  );
}

function BrowserBar() {
  return (
    <div className="dd-browser-bar">
      <i>
        <b />
      </i>
      <span className="dd-browser-url">
        <I name="lock" size="xs" />
        <span className="dd-t12">harborvault.xyz</span>
      </span>
    </div>
  );
}

function AppHead() {
  return (
    <div className="dd-head">
      <h4>Harbor Vault</h4>
      <span className="site">
        <span className="dd-t14">harborvault.xyz</span>
        <I name="arrowUpRight" size="xs" />
      </span>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/metamask.svg" alt="" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icons/ethereum.svg" alt="" />
      <span className="dd-t14 dd-muted">Last run 2 min ago</span>
      <div className="dd-btns">
        <span className="dd-btn">
          <I name="plus" size="sm" />
          <span>Add test</span>
        </span>
        <span className="dd-btn">
          <I name="compass" size="sm" />
          <span>Explore again</span>
        </span>
        <span className="dd-btn dark">
          <I name="play" size="xs" />
          <span>Run all</span>
        </span>
      </div>
    </div>
  );
}

function Tabs({ on }: { on: "tests" | "bugs" }) {
  return (
    <div className="dd-tabs">
      <span className={on === "tests" ? "on" : undefined}>
        <I name="listChecks" size="sm" />
        <b>Tests</b>
        <em>6</em>
      </span>
      <span>
        <I name="compass" size="sm" />
        <b>Checks</b>
        <em>41</em>
      </span>
      <span className={on === "bugs" ? "on" : undefined}>
        <I name="bug" size="sm" />
        <b>Bugs</b>
        <em className="bad">4</em>
      </span>
    </div>
  );
}

/** Runs over the last two weeks: passed, with failed on top. */
const HISTORY = [0, 0, 0, 0, 0, 0, 2, 3, 2, 4, 3, 6, 5, 6];
const FAILED = [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 3];

const TESTS: { name: string; conditions?: [string, boolean][] }[] = [
  {
    name: "Deposit hUSDC into the vault",
    conditions: [
      ["Rejected in wallet", false],
      ["Slow RPC", true],
      ["Wrong network", false],
      ["Not enough gas", true],
    ],
  },
  {
    name: "Withdraw hUSDC",
    conditions: [
      ["Rejected in wallet", true],
      ["Slow RPC", true],
      ["Not enough gas", false],
    ],
  },
  { name: "Claim the deposit bonus" },
  { name: "Get test hUSDC" },
  { name: "Connect a wallet" },
];

function TestList() {
  return (
    <div className="dd-card dd-list">
      <div className="dd-filter">
        <span className="on">All</span>
        <span>Passed 6</span>
        <span className="by">
          <I name="fork" size="sm" />
          <span className="dd-t12">By condition</span>
        </span>
      </div>
      {TESTS.map((t) => (
        <div className="dd-test" key={t.name}>
          <div className="dd-test-row">
            <span className="dd-mark pass">
              <I name="check" />
            </span>
            <span className="name">{t.name}</span>
            <span className="when">Passed · 2 min ago</span>
          </div>
          {t.conditions && (
            <div className="dd-forks">
              {t.conditions.map(([name, passed]) => (
                <div className="dd-fork" key={name}>
                  <span className={`dd-mark sm ${passed ? "pass" : "fail"}`}>
                    <I name={passed ? "check" : "x"} />
                  </span>
                  <span className="name">{name}</span>
                  {!passed && <span className="bad">Failed</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The app's page: how it is doing over the last two weeks, then its tests. */
export function AppPicture() {
  return (
    <Window label="DappDrill's page for Harbor Vault: 3 conditions failed, 4 bugs from 41 checks, and the tests with their conditions.">
      <AppHead />
      <div className="dd-hero">
        <div className="dd-verdict">
          <p className="bad">3 conditions failed</p>
          <p>
            <span className="bad">4 bugs</span>
            <span className="dim"> from 41 checks</span>
          </p>
        </div>
        <div className="dd-card dd-chart">
          <div className="dd-chart-top">
            <b>Last 14 days</b>
            <span className="dd-t13 dd-muted">
              <b style={{ fontSize: "1em", color: "var(--fg)" }}>91%</b> of 46 runs passed
            </span>
          </div>
          <div className="dd-bars">
            {HISTORY.map((n, i) => {
              const failed = FAILED[i] ?? 0;
              return (
                <i key={i} style={{ height: n ? `${((n + failed) / 9) * 100}%` : "12%" }}>
                  {failed > 0 && <s style={{ height: `${(failed / (n + failed)) * 100}%` }} />}
                  {n > 0 && <b style={{ flex: 1 }} />}
                </i>
              );
            })}
          </div>
          <div className="dd-legend">
            <span>
              <i style={{ background: "#34d399" }} />
              <span className="dd-t12">Passed</span>
            </span>
            <span>
              <i style={{ background: "#fb7190" }} />
              <span className="dd-t12">Failed</span>
            </span>
            <span className="dd-t12" style={{ marginLeft: "auto" }}>
              41s typical run
            </span>
          </div>
        </div>
      </div>
      <Tabs on="tests" />
      <TestList />
    </Window>
  );
}

const FEED: [string, string][] = [
  ["bug", "Deposit stays on “Confirming…” after rejecting in the wallet"],
  ["test", "Saved a test: Claim the deposit bonus"],
  ["wallet", "Wallet asked to deposit 250 hUSDC"],
  ["pass", "Withdraw 100 hUSDC worked"],
  ["note", "Looking at the Rewards page"],
  ["fail", "On the wrong network the deposit was sent anyway"],
  ["note", "Trying the faucet twice in a row"],
];
const DOT: Record<string, string> = { bug: "#c9184a", fail: "#c9184a", test: "#047857", pass: "#047857", wallet: "#0369a1", note: "#e5e5e5" };

/** Exploring, as it happens: what one browser sees, and what they've all found so far. */
export function ExploreAppPicture() {
  return (
    <Window label="DappDrill exploring Harbor Vault: a browser using the app on the left; on the right, 5 tests, 23 checks and 2 bugs so far, with what each browser just did.">
      <AppHead />
      <div className="dd-pass">
        <div className="dd-browser">
          <BrowserBar />
          <Site
            width={63.4}
            state="idle"
            overlay={
              <span className="dd-doing">
                <span className="dd-t13">Withdrawing with too little ETH for gas</span>
              </span>
            }
          />
        </div>
        <div className="dd-live">
          <div className="dd-live-top">
            <span className="dot" />
            <span className="dd-t13">Exploring · 3:12 · 6 minutes left</span>
            <span className="dd-btn">
              <span>Stop</span>
            </span>
          </div>
          <h5>Running tests and checks</h5>
          <div className="dd-outcomes">
            {(
              [
                ["listChecks", "live", "Tests", 5, "User flows, run again on every change"],
                ["compass", "fork", "Checks", 23, "One-off checks while exploring"],
                ["bug", "bad", "Bugs", 2, "What either one finds wrong"],
              ] as const
            ).map(([icon, tint, label, n, what]) => (
              <div className="dd-outcome" key={label}>
                <span className={`dd-tile ${tint}`}>
                  <I name={icon} />
                </span>
                <p>
                  <b>
                    {label}
                    <em>{n}</em>
                  </b>
                  <small>{what}</small>
                </p>
              </div>
            ))}
          </div>
          <ol className="dd-feed">
            {FEED.map(([kind, text]) => (
              <li key={text} className={kind === "bug" ? "bug" : undefined}>
                <i style={{ background: DOT[kind] }} />
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div className="dd-thumbs">
        {["Withdraw hUSDC", "Deposit hUSDC", "Claim the bonus", "Get test hUSDC", "Switch account"].map((t, i) => (
          <div className={i === 0 ? "dd-thumb on" : "dd-thumb"} key={t}>
            <i />
            <span>{t}</span>
          </div>
        ))}
      </div>
    </Window>
  );
}

const STEPS: [string, string][] = [
  ["Enter 250 as the deposit amount", "Type “250” into “Amount”"],
  ["Click Approve 250 hUSDC", "Connect the wallet if asked, then click “Approve 250 hUSDC”"],
  ["Approve in the wallet", "Approve hUSDC for HarborVault 0xe7f1…0512"],
  ["Click Deposit", "Click “Deposit”"],
  ["Confirm in the wallet", "Deposit 250 hUSDC to HarborVault 0xe7f1…0512"],
];

/** A test: what it is for, its steps, and the run's video and wallet requests. */
export function TestPicture() {
  return (
    <Window label="A DappDrill test, Deposit hUSDC into the vault: its goal, expected result and steps, the run's video, and the three requests the wallet approved.">
      <span className="dd-crumb dd-t13 dd-muted">Tests</span>
      <div className="dd-title">
        <h4>Deposit hUSDC into the vault</h4>
        <div className="dd-btns">
          <span className="dd-btn dark">
            <I name="play" size="xs" />
            <span>Run</span>
          </span>
          <span className="dd-btn">
            <span>Duplicate</span>
          </span>
        </div>
      </div>
      <div className="dd-status">
        <span className="dd-mark sm pass">
          <I name="check" />
        </span>
        <span className="dd-t13">
          <span className="good">Passed</span> · 2 min ago · took 41s · fork of Ethereum
        </span>
      </div>
      <div className="dd-cols">
        <div className="dd-col">
          <div className="dd-field">
            <h6>Goal</h6>
            <p>Deposit 250 hUSDC on the Vault page and confirm the position grows.</p>
          </div>
          <div className="dd-field">
            <h6>Expected result</h6>
            <p>The position shows 250 hUSDC deposited and the wallet shows 750 hUSDC.</p>
            <span className="dd-proved">
              <I name="check" size="sm" />
              <span className="dd-t13">“Your position” reads 242.43 hvUSDC, worth 250 hUSDC; the header shows 750 hUSDC.</span>
            </span>
          </div>
          <div className="dd-card dd-steps">
            {STEPS.map(([name, how]) => (
              <div className="dd-step" key={name}>
                <span className="dd-mark sm pass">
                  <I name="check" />
                </span>
                <p>
                  <b>{name}</b>
                  <small>{how}</small>
                </p>
                <i />
              </div>
            ))}
          </div>
        </div>
        <div className="dd-col">
          <div className="dd-video">
            <Site width={53.4} state="wallet">
              <Wallet />
            </Site>
            <div className="dd-video-bar">
              <I name="play" size="sm" />
              <span className="dd-t12">0:26 / 0:41</span>
              <span className="track">
                <b />
              </span>
            </div>
          </div>
          <div className="dd-card">
            <div className="dd-wallet-head">
              <I name="wallet" size="sm" />
              <span className="dd-t13">Wallet</span>
              <span className="dd-t13 dd-muted">3</span>
            </div>
            {(
              [
                ["Connect", "0x7a3F…41e1 on Ethereum (fork)"],
                ["Approve hUSDC", "For HarborVault 0xe7f1…0512"],
                ["Deposit 250 hUSDC", "To HarborVault 0xe7f1…0512"],
              ] as const
            ).map(([what, detail]) => (
              <div className="dd-wallet-row" key={what}>
                <p>
                  <b>{what}</b>
                  <small>{detail}</small>
                </p>
                <span className="dd-t12 dd-muted">Approved</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Window>
  );
}

/** The tests again, further down: every test with the conditions it was replayed under. */
export function ConditionsPicture() {
  return (
    <Window label="Harbor Vault's tests in DappDrill, each replayed under conditions: rejected in wallet, slow RPC, wrong network, not enough gas. Three conditions failed.">
      <Tabs on="tests" />
      <TestList />
    </Window>
  );
}

const BUGS: [string, string][] = [["Deposit sent while the wallet is on the wrong network", "Deposit hUSDC into the vault · Wrong network"]];

/** The bugs, one of them open: how to make it happen, expected against got, the page, and the second look. */
export function BugsPicture() {
  return (
    <Window label="Harbor Vault's bugs in DappDrill. One is open: after rejecting the deposit in the wallet, the button stays on Confirming. It has the steps, expected against got, the page when it happened, and what a second look in a fresh browser saw.">
      <Tabs on="bugs" />
      <div className="dd-card dd-list">
        <div className="dd-filter">
          <span className="on">All</span>
          <span>From a test 3</span>
          <span>From a check 1</span>
        </div>
        {BUGS.map(([title, from]) => (
          <div className="dd-bug" key={title}>
            <span className="dd-tile sm bad">
              <I name="bug" />
            </span>
            <p>
              <b>{title}</b>
              <small>
                <I name="listChecks" size="xs" />
                <span className="dd-t12">From the test {from}</span>
              </small>
            </p>
            <span className="dd-tag high">High</span>
            <I name="chevronRight" size="sm" />
          </div>
        ))}
        <div className="dd-bug open">
          <span className="dd-tile sm bad">
            <I name="bug" />
          </span>
          <p>
            <b>Deposit stuck on “Confirming…” after rejecting in wallet</b>
            <small>
              <I name="listChecks" size="xs" />
              <span className="dd-t12">From the test Deposit hUSDC into the vault · Rejected in wallet</span>
            </small>
          </p>
          <span className="dd-tag high">High</span>
          <I name="chevronDown" size="sm" />
        </div>
        <div className="dd-bug-body">
          <div className="dd-evidence">
            <div className="dd-col" style={{ gap: "1.4em" }}>
              <ol className="dd-repro">
                {["Connect the wallet on the Vault page", "Enter 250 as the deposit amount", "Click Deposit", "Reject the request in the wallet"].map((s, i) => (
                  <li key={s}>
                    <i>
                      <span>{i + 1}</span>
                    </i>
                    <span className="dd-t13">{s}</span>
                  </li>
                ))}
              </ol>
              <div className="dd-sides">
                <div className="dd-side good">
                  <h6>
                    <I name="circleCheck" size="xs" />
                    <span className="dd-t12">Expected</span>
                  </h6>
                  <span className="dd-t13">The Deposit button is back, so the user can try again</span>
                </div>
                <div className="dd-side bad">
                  <h6>
                    <I name="circleX" size="xs" />
                    <span className="dd-t12">Got</span>
                  </h6>
                  <span className="dd-t13">It stays on “Confirming…”, with no message</span>
                </div>
              </div>
            </div>
            <div className="dd-browser">
              <BrowserBar />
              <Site width={43.3} state="stuck" />
            </div>
          </div>
          <div className="dd-saw">
            <I name="scan" size="sm" />
            <p>
              <b>What the fresh browser saw</b>
              <span className="dd-t13">The wallet log shows the deposit rejected with 4001, and the button still reads “Confirming…”. The user can’t retry without reloading.</span>
            </p>
          </div>
        </div>
        {/* Below the fold of the picture, so the list carries on past its edge. */}
        <div className="dd-bug">
          <span className="dd-tile sm bad">
            <I name="bug" />
          </span>
          <p>
            <b>The page goes blank when withdrawing without ETH for gas</b>
            <small>
              <I name="listChecks" size="xs" />
              <span className="dd-t12">From the test Withdraw hUSDC · Not enough gas</span>
            </small>
          </p>
          <span className="dd-tag high">High</span>
          <I name="chevronRight" size="sm" />
        </div>
      </div>
    </Window>
  );
}
