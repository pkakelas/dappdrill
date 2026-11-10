import type { Metadata } from "next";
import { Doc } from "@/components/doc";
import { COMPANY } from "@/site";

export const metadata: Metadata = {
  title: "Privacy policy · DappDrill",
  description: `How ${COMPANY.name} handles personal data on this website and in DappDrill.`,
};

const UPDATED = "10 November 2026";

export default function Privacy() {
  const mail = <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>;
  return (
    <Doc label={`Privacy · Last updated ${UPDATED}`} title="Privacy policy" intro="What we collect when you visit this site or use DappDrill, why, and what you can ask us to do with it.">
      <h2>Who we are</h2>
      <p>
        DappDrill and this website are run by {COMPANY.name} (“we”, “us”). We decide how the personal data described here is
        used. You can reach us about anything in this policy at {mail}.
      </p>

      <h2>What we collect</h2>
      <p>
        <b>When you visit this website.</b> The site sets no cookies and runs no analytics or advertising scripts. The servers
        that deliver it may keep standard request logs (IP address, browser, the page asked for, time) for a short time to
        keep the site running and secure.
      </p>
      <p>
        <b>When you email us</b>, for example to ask for early access: your email address, your name if you give it, and what
        you write.
      </p>
      <p>
        <b>When you use DappDrill:</b>
      </p>
      <ul>
        <li>Account details: your name, email address and password (stored only as a hash), or your basic profile if you sign in with Google.</li>
        <li>Your organization: its name, the people you invite and their roles.</li>
        <li>The apps you add: their addresses and settings, and any test accounts or test wallet keys you give us. Keys and passwords are stored encrypted.</li>
        <li>
          What runs produce: tests, results, screenshots, videos, traces and logs of the pages being tested. These show
          whatever those pages show, so point DappDrill at apps and test accounts, not at pages full of other people’s personal
          data.
        </li>
        <li>Usage and error logs from our servers, used to keep the service working.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To provide DappDrill: run your tests, store the results and show them to you and your team.</li>
        <li>To run your account, answer your messages and tell you about changes to the service.</li>
        <li>To keep the service secure and to find and fix problems.</li>
        <li>To meet legal obligations, such as keeping invoices.</li>
      </ul>
      <p>
        We use your data because we need it to provide the service you signed up for, because we have a legitimate interest in
        running and securing it, or because the law requires it. We do not sell personal data, and we do not use it for
        advertising.
      </p>

      <h2>Who we share it with</h2>
      <p>
        Only with service providers that help us run DappDrill, under agreements that limit them to doing that: hosting and
        database providers, an email provider, Google if you choose to sign in with it, and the language model provider
        (currently Anthropic) that reads the pages under test to explore them, run test steps and judge results. Some of
        these providers may process data outside your country; when they do, we rely on the safeguards the law requires, such
        as standard contractual clauses.
      </p>
      <p>We may also disclose data if the law requires it, or to protect our users or the service.</p>

      <h2>How long we keep it</h2>
      <p>
        We keep account and organization data while your account is open. Test results and recordings stay until you delete
        them, delete the app, or close your account. After you close your account we delete your data within a reasonable time,
        except what the law requires us to keep. Emails are kept as long as the conversation needs them.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask us for a copy of your personal data, to correct it, to delete it, to send it to you in a portable format,
        or to stop or limit how we use it. Write to {mail} and we will answer within a month. If you think we have handled
        your data wrongly, you can also complain to your local data protection authority.
      </p>

      <h2>Security</h2>
      <p>
        Data travels over encrypted connections, and keys and passwords you give us for test accounts are encrypted at rest.
        Tests run against local forks of the chain with test wallets, never with real funds on mainnet.
      </p>

      <h2>Children</h2>
      <p>DappDrill is a tool for businesses and is not meant for anyone under 16. We do not knowingly collect their data.</p>

      <h2>Changes</h2>
      <p>
        If we change this policy, we will update it here and change the date at the top. If a change matters, we will also
        tell account holders by email.
      </p>
    </Doc>
  );
}
