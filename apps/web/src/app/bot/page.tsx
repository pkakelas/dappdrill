import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/common";

export const metadata: Metadata = {
  title: "The DappDrill browser",
  description: "What DappDrill's test browser is, how to recognise it, and how to let it past your bot protection.",
};

const UA_TOKEN = "DappDrill/1.0 (+https://dappdrill.com/bot)";

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em]">{children}</code>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function BotPage() {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={18} />
            <span className="font-semibold">DappDrill</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 leading-relaxed text-muted-foreground sm:px-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">The DappDrill browser</h1>
          <p className="text-base">
            DappDrill tests web3 apps for the teams that build them. It opens the app in a real Chromium with a test wallet, on a local copy of the chain, and
            clicks through it like a user would.
          </p>
        </header>

        <Section title="How to recognise it">
          <p>
            Every request carries a normal Chrome user agent with <Code>{UA_TOKEN}</Code> appended. It browses at a person&apos;s pace and only visits the app
            it was pointed at. Transactions go to a local fork, never to the real chain.
          </p>
        </Section>

        <Section title="It never solves CAPTCHAs">
          <p>
            When DappDrill meets a CAPTCHA or bot check, it stops and reports which one it saw. It doesn&apos;t solve challenges, fake a human fingerprint or
            rotate IPs. If it&apos;s your app, let it in with one of the options below.
          </p>
        </Section>

        <Section title="Let it in with a secret header">
          <p>
            In your app&apos;s scan settings, under <strong className="font-medium text-foreground">Bot protection</strong>, add a header name and a secret value (for example{" "}
            <Code>x-dappdrill-token</Code>). DappDrill sends it only to your app&apos;s own domain and its subdomains, never to RPCs, analytics or other third
            parties, and stores it encrypted. Then tell your protection to skip requests that carry it:
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong className="font-medium text-foreground">Cloudflare:</strong> add a WAF custom rule that matches the header with your secret value, with the action <em>Skip</em>, skipping the
              bot and challenge rules. Cloudflare doesn&apos;t let the free plan&apos;s Bot Fight Mode be skipped this way; use a preview or staging URL
              without it instead.
            </li>
            <li>
              <strong className="font-medium text-foreground">Vercel:</strong> turn on <em>Protection Bypass for Automation</em> in your project&apos;s Deployment Protection settings and use{" "}
              <Code>x-vercel-protection-bypass</Code> as the header name, with the secret Vercel generates. For Vercel Firewall challenges, add a bypass rule
              on the same header.
            </li>
            <li>
              <strong className="font-medium text-foreground">Turnstile, hCaptcha or reCAPTCHA in your own code:</strong> on staging builds, use the provider&apos;s published test site key, which
              always passes, and point DappDrill at that build.
            </li>
            <li>
              <strong className="font-medium text-foreground">Other providers (Akamai, DataDome, HUMAN):</strong> allow requests carrying your header in their rules, or test a preview URL that
              isn&apos;t behind them.
            </li>
          </ul>
        </Section>

        <Section title="In CI">
          <p>
            The CLI takes <Code>--header &quot;x-dappdrill-token: …&quot;</Code>, or reads one header per line from the <Code>DAPPDRILL_HEADERS</Code>{" "}
            environment variable, so the secret can stay in your CI&apos;s secret store. Testing a build that CI starts on localhost avoids bot protection
            altogether.
          </p>
        </Section>
      </main>
    </>
  );
}
