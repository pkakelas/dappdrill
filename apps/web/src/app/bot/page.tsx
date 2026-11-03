import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/ui";

export const metadata: Metadata = {
  title: "The DappDrill browser",
  description: "What DappDrill's test browser is, how to recognise it, and how to let it past your bot protection.",
};

const UA_TOKEN = "DappDrill/1.0 (+https://dappdrill.com/bot)";

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-sub px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="h2">{title}</h2>
      {children}
    </section>
  );
}

export default function BotPage() {
  return (
    <>
      <header className="border-b border-line">
        <div className="page flex items-center justify-between gap-3 py-3.5">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <Logo />
            <span className="font-serif text-[20px] tracking-[-0.02em]">DappDrill</span>
          </Link>
        </div>
      </header>
      <main className="page flex max-w-[720px] flex-col gap-9 py-10 text-[15px] leading-relaxed text-ink-2">
        <header className="flex flex-col gap-3">
          <h1 className="h1">The DappDrill browser</h1>
          <p className="m-0 text-[17px] text-ink-3">
            DappDrill tests web3 apps for the teams that build them. It opens the app in a real Chromium with a test wallet, on a local copy of the chain, and
            clicks through it like a user would.
          </p>
        </header>

        <Section title="How to recognise it">
          <p className="m-0">
            Every request carries a normal Chrome user agent with <Code>{UA_TOKEN}</Code> appended. It browses at a person&apos;s pace and only visits the app
            it was pointed at. Transactions go to a local fork, never to the real chain.
          </p>
        </Section>

        <Section title="It never solves CAPTCHAs">
          <p className="m-0">
            When DappDrill meets a CAPTCHA or bot check, it stops and reports which one it saw. It doesn&apos;t solve challenges, fake a human fingerprint or
            rotate IPs. If it&apos;s your app, let it in with one of the options below.
          </p>
        </Section>

        <Section title="Let it in with a secret header">
          <p className="m-0">
            In your app&apos;s scan settings, under <strong>Bot protection</strong>, add a header name and a secret value (for example{" "}
            <Code>x-dappdrill-token</Code>). DappDrill sends it only to your app&apos;s own domain and its subdomains, never to RPCs, analytics or other third
            parties, and stores it encrypted. Then tell your protection to skip requests that carry it:
          </p>
          <ul className="m-0 flex flex-col gap-2.5 pl-5">
            <li>
              <strong>Cloudflare:</strong> add a WAF custom rule that matches the header with your secret value, with the action <em>Skip</em>, skipping the
              bot and challenge rules. Cloudflare doesn&apos;t let the free plan&apos;s Bot Fight Mode be skipped this way; use a preview or staging URL
              without it instead.
            </li>
            <li>
              <strong>Vercel:</strong> turn on <em>Protection Bypass for Automation</em> in your project&apos;s Deployment Protection settings and use{" "}
              <Code>x-vercel-protection-bypass</Code> as the header name, with the secret Vercel generates. For Vercel Firewall challenges, add a bypass rule
              on the same header.
            </li>
            <li>
              <strong>Turnstile, hCaptcha or reCAPTCHA in your own code:</strong> on staging builds, use the provider&apos;s published test site key, which
              always passes, and point DappDrill at that build.
            </li>
            <li>
              <strong>Other providers (Akamai, DataDome, HUMAN):</strong> allow requests carrying your header in their rules, or test a preview URL that
              isn&apos;t behind them.
            </li>
          </ul>
        </Section>

        <Section title="In CI">
          <p className="m-0">
            The CLI takes <Code>--header &quot;x-dappdrill-token: …&quot;</Code>, or reads one header per line from the <Code>DAPPDRILL_HEADERS</Code>{" "}
            environment variable, so the secret can stay in your CI&apos;s secret store. Testing a build that CI starts on localhost avoids bot protection
            altogether.
          </p>
        </Section>
      </main>
    </>
  );
}
