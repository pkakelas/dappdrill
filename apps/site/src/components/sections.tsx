import { CTA, NAV } from "@/site";
import { AppPicture } from "./app-pictures";
import { Wordmark } from "./logo";

/** The mark, very large, rising behind the browser. */
function Sunrise() {
  return (
    <div aria-hidden="true" className="absolute top-0 left-1/2 aspect-square w-[min(1240px,118%)] -translate-x-1/2 overflow-hidden rounded-full border-[1.5px] border-white/18">
      <div className="absolute inset-y-0 right-0 w-1/2 bg-red" />
    </div>
  );
}

export function Hero() {
  return (
    <section id="top" data-dark className="relative overflow-hidden bg-ink text-white">
      <div className="wrap flex min-h-[max(100svh,760px)] flex-col items-center pt-[clamp(128px,19vh,210px)] text-center">
        <h1 className="display max-w-[16ch] text-[clamp(42px,6.4vw,92px)]">
          A QA engineer that understands <span className="text-white/45">crypto and wallets.</span>
        </h1>
        <p className="mt-7 max-w-[44ch] text-[clamp(16px,1.35vw,19px)] leading-[1.5] text-pretty text-white/65">
          Every flow of your dApp tested on forks, <br className="hidden sm:block" />including the odd cases real users run into.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <a href={CTA.href} className="btn bg-white text-ink hover:bg-white/85">
            {CTA.label}
          </a>
          <a href="#how" className="btn text-white/80 hover:text-white">
            See how it works
          </a>
        </div>
        <div className="relative mt-auto w-full max-w-[1040px] pt-[clamp(72px,11vh,130px)]">
          <Sunrise />
          <div className="relative h-[clamp(230px,42vh,460px)] overflow-hidden rounded-t-[14px]">
            <AppPicture />
          </div>
        </div>
      </div>
    </section>
  );
}

const RUN = [
  ["ok", "Deposit hUSDC", "41s"],
  ["ok", "Withdraw hUSDC", "38s"],
  ["ok", "Claim rewards", "22s"],
  ["ok", "Get test hUSDC", " 9s"],
  ["gap"],
  ["fail", "Deposit hUSDC · Rejected in wallet", "17s"],
  ["why", "The Deposit button stays on “Confirming…” after the wallet rejects."],
  ["ok", "Deposit hUSDC · Slow RPC", "58s"],
  ["ok", "Deposit hUSDC · Wrong network", "12s"],
  ["ok", "Deposit hUSDC · Not enough gas", "14s"],
] as const;

export function Ci() {
  return (
    <section id="ci" className="wrap scroll-mt-24 py-[clamp(88px,11vw,168px)]">
      <div className="grid grid-cols-1 items-start gap-x-10 gap-y-12 lg:grid-cols-12">
        <div className="min-w-0 lg:sticky lg:top-32 lg:col-span-4">
          <p className="label text-ink/50">In CI</p>
          <h2 className="display mt-5 text-[clamp(38px,4.4vw,64px)]">Runs on every change.</h2>
          <p className="mt-6 max-w-[34ch] text-[17px] leading-[1.5] text-pretty text-ink/65">
            The same tests from the CLI or a GitHub Action, with JUnit, JSON and Markdown reports.
          </p>
        </div>
        <div className="relative min-w-0 lg:col-span-8 lg:pb-24">
          <div className="overflow-hidden rounded-[22px] bg-ink text-white shadow-[0_40px_80px_-40px_rgb(15_15_14/0.5)]">
            <div className="flex items-center gap-2 border-b border-white/8 px-5 py-4">
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
              <i className="size-2.5 rounded-full bg-white/15" />
            </div>
            <pre className="overflow-x-auto px-6 py-6 font-mono text-[12.5px] leading-[1.75] sm:px-8 sm:py-7 sm:text-[13.5px] lg:pb-24">
              <span className="text-red">$</span> dappdrill run --unhappy{"\n"}
              <span className="text-white/45">Running 4 tests on https://harborvault.xyz</span>
              {"\n\n"}
              {RUN.map((row, i) => {
                if (row[0] === "gap") return "\n";
                if (row[0] === "why") {
                  return (
                    <span key={i} className="text-red">
                      {"      "}
                      {row[1]}
                      {"\n"}
                    </span>
                  );
                }
                const [state, name, secs] = row;
                return (
                  <span key={i} className={state === "fail" ? "text-red" : undefined}>
                    {"  "}
                    <span className={state === "ok" ? "text-pass" : undefined}>{state === "ok" ? "✓" : "✗"}</span> {name.padEnd(36)}
                    <span className={state === "ok" ? "text-white/40" : undefined}>{secs}</span>
                    {"\n"}
                  </span>
                );
              })}
              {"\n"}
              <span className="text-red">7 of 8 passed, 1 failed.</span> <span className="text-white/45">Videos and screenshots: dappdrill-out/artifacts</span>
            </pre>
          </div>
          <div className="mt-4 rounded-[18px] border border-ink/8 bg-white p-5 shadow-[0_30px_60px_-36px_rgb(15_15_14/0.45)] sm:p-6 lg:absolute lg:bottom-0 lg:-left-16 lg:mt-0 lg:w-[540px]">
            <p className="font-mono text-[12px] text-ink/45">.github/workflows/dappdrill.yml</p>
            <pre className="mt-3 overflow-x-auto font-mono text-[12.5px] leading-[1.7] text-ink/85">
              <span className="text-ink/45">- uses:</span> dappdrill/dappdrill/.github/actions/dappdrill@main{"\n"}
              <span className="text-ink/45">{"  with:"}</span>
              {"\n"}
              <span className="text-ink/45">{"    url:"}</span> {"${{ steps.preview.outputs.url }}"}
              {"\n"}
              <span className="text-ink/45">{"    unhappy:"}</span> {'"true"'}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

const CONTRACT = ["Audits", "Fuzzing and invariant tests", "Formal verification", "Bug bounties after launch"];
const SCREEN = ["What happens when the user rejects?", "Wrong network? A switched account?", "Two wallets installed?", "A slow RPC?"];

export function Why() {
  return (
    <section id="why" className="wrap scroll-mt-24">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-h-[400px] lg:min-h-[520px] flex-col rounded-[28px] bg-paper-2 p-8 sm:p-12">
          <p className="label text-ink/50">The contract</p>
          <h2 className="display mt-5 text-[clamp(34px,3.6vw,52px)]">Audited, fuzzed, proven, bountied.</h2>
          <ul className="mt-auto space-y-3 pt-16 text-[17px] text-ink/70">
            {CONTRACT.map((item) => (
              <li key={item} className="flex items-center gap-3.5">
                <svg viewBox="0 0 16 16" className="size-4 text-ink/40" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m3 8.5 3.2 3.2L13 4.5" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div data-dark className="flex min-h-[400px] lg:min-h-[520px] flex-col rounded-[28px] bg-ink p-8 text-white sm:p-12">
          <p className="label text-white/50">The screen</p>
          <h2 className="display mt-5 text-[clamp(34px,3.6vw,52px)]">
            Clicked through by hand, <span className="text-red">the day before release.</span>
          </h2>
          <ul className="mt-auto space-y-3 pt-16 text-[17px] text-white/75">
            {SCREEN.map((item) => (
              <li key={item} className="flex items-center gap-3.5">
                <span className="grid size-4 place-items-center rounded-full border border-red font-mono text-[10px] leading-none text-red" aria-hidden="true">
                  ?
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** One click, two calls. */
function TwoCalls() {
  return (
    <div className="flex w-full items-center gap-4">
      <span className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-white">Supply</span>
      <div className="relative h-px flex-1 bg-ink/20">
        <i className="absolute -top-2 left-[18%] h-4 w-px bg-ink/45" />
        <i className="absolute -top-3.5 left-[62%] h-7 w-[3px] rounded-full bg-red" />
        <i className="absolute -top-3.5 left-[calc(62%+8px)] h-7 w-[3px] rounded-full bg-red" />
        <span className="absolute top-4 left-[18%] -translate-x-1/2 font-mono text-[11px] text-ink/50">1 click</span>
        <span className="absolute top-4 left-[calc(62%+5px)] -translate-x-1/2 font-mono text-[11px] whitespace-nowrap text-red">supply() ×2</span>
      </div>
    </div>
  );
}

/** Picked one wallet, got the other. */
function TwoWallets() {
  const row = "flex items-center gap-2.5 rounded-full bg-white py-1.5 pr-4 pl-2 text-[13px] font-medium";
  return (
    <div className="flex w-full items-center justify-center gap-5">
      <span className="grid size-11 place-items-center rounded-xl bg-ink text-[12px] font-semibold text-white">dApp</span>
      <div className="space-y-2">
        <div className={`${row} text-ink/45`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/metamask.svg" alt="" width={22} height={22} className="size-[22px] opacity-60" />
          MetaMask <span className="ml-3 font-mono text-[11px]">picked</span>
        </div>
        <div className={`${row} ring-[1.5px] ring-red`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/rabby.svg" alt="" width={22} height={22} className="size-[22px]" />
          Rabby <span className="ml-3 font-mono text-[11px] text-red">used</span>
        </div>
      </div>
    </div>
  );
}

/** Still connecting. */
function Hang() {
  return (
    <div className="flex w-full items-center justify-center gap-5">
      <span className="flex items-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-[13px] font-medium text-ink/70">
        <i className="spin text-ink/40" />
        Connecting…
      </span>
      <span className="font-mono text-[13px] text-red">3:02</span>
    </div>
  );
}

const FINDINGS = [
  { where: "Compound", when: "Slow RPC", what: "One click sent two deposits.", proof: "two supply() calls, 6 ms apart", figure: <TwoCalls /> },
  { where: "Compound", when: "Two wallets", what: "The user picked MetaMask. The app talked to Rabby.", proof: "EIP-6963 choice ignored", figure: <TwoWallets /> },
  { where: "pod", when: "Wrong network", what: "Sign-in hangs on “Connecting…” forever.", proof: "no switch prompt, no message", figure: <Hang /> },
];

export function Findings() {
  return (
    <section id="findings" className="wrap scroll-mt-24 py-[clamp(88px,11vw,168px)]">
      <p className="label text-ink/50">On live frontends</p>
      <h2 className="display mt-5 max-w-[19ch] text-[clamp(38px,4.4vw,64px)]">Most bugs aren’t attacks. They’re a real user doing something unexpected.</h2>
      <ol className="mt-16 border-b border-ink/12">
        {FINDINGS.map((f) => (
          <li key={f.what} className="grid items-center gap-x-10 gap-y-5 border-t border-ink/12 py-9 lg:grid-cols-12">
            <p className="label text-ink/50 lg:col-span-3">
              {f.where} <span className="text-ink/25">/</span> {f.when}
            </p>
            <div className="lg:col-span-5">
              <p className="display text-[clamp(26px,2.5vw,36px)] leading-[1.08]">{f.what}</p>
              <p className="mt-3 font-mono text-[13px] text-red">{f.proof}</p>
            </div>
            <div className="flex h-[124px] items-center rounded-[20px] bg-paper-2 px-7 lg:col-span-4">{f.figure}</div>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-[13.5px] text-ink/50">Found by DappDrill on live frontends, run on local forks, November 2026. Each finding checked by hand.</p>
    </section>
  );
}

export function Close() {
  return (
    <section data-dark className="bg-ink text-white">
      <div className="wrap flex flex-col items-center pt-[clamp(110px,14vw,200px)] pb-[clamp(96px,12vw,170px)] text-center">
        <h2 className="display text-[clamp(46px,7.4vw,104px)]">
          Paste a URL. <span className="text-white/40">Get a bug report.</span>
        </h2>
        <div className="mt-12 flex h-[68px] w-full max-w-[620px] items-center gap-3 rounded-full bg-white py-2 pr-2 pl-5 sm:pl-6 text-ink">
          <svg viewBox="0 0 20 20" className="size-5 flex-none text-ink/40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M2.5 10h15M10 2.5c2.4 2.2 2.4 12.800 0 15M10 2.500c-2.400 2.200-2.400 12.800 0 15" />
          </svg>
          <span className="min-w-0 flex-1 overflow-hidden text-left font-mono text-[clamp(14px,1.6vw,19px)] whitespace-nowrap" aria-hidden="true">
            <span className="typed">app.yourdapp.xyz</span>
            <i className="caret" />
          </span>
          <a href={CTA.href} className="btn h-[52px] flex-none bg-ink px-7 text-white hover:bg-ink/85">
            Drill
          </a>
        </div>
      </div>
      <footer className="wrap flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-white/10 py-8 text-[14px] text-white/50">
        <span className="text-white">
          <Wordmark size={18} />
        </span>
        {NAV.map((item) => (
          <a key={item.href} href={item.href} className="transition-colors hover:text-white">
            {item.label}
          </a>
        ))}
        <span className="sm:ml-auto">© 2026 DappDrill</span>
      </footer>
    </section>
  );
}
