import type { Metadata } from "next";
import { Doc } from "@/components/doc";
import { COMPANY } from "@/site";

export const metadata: Metadata = {
  title: "Terms of service · DappDrill",
  description: `The terms for using DappDrill, a service by ${COMPANY.name}.`,
};

const UPDATED = "10 November 2026";

export default function Terms() {
  const mail = <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>;
  return (
    <Doc
      label={`Terms · Last updated ${UPDATED}`}
      title="Terms of service"
      intro="The agreement between you and us when you use DappDrill. Please read it before you sign up."
    >
      <h2>Who these terms are with</h2>
      <p>
        DappDrill is provided by {COMPANY.name} (“we”, “us”). By creating an account or using DappDrill you agree to these
        terms. If you use it for a company or other organization, you agree on its behalf and confirm you are allowed to. If
        you don’t agree, don’t use the service.
      </p>

      <h2>The service</h2>
      <p>
        DappDrill explores web3 apps, writes tests for them and runs those tests in a browser with a test wallet against local
        forks of the chain. It reports what it finds, with recordings. We keep improving it, so features may change, and parts
        may be offered as early access while we work on them.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Give us accurate details and keep your login safe. You are responsible for what happens under your account.</li>
        <li>You must be at least 16 and able to enter a binding contract.</li>
        <li>Tell us at {mail} if you think someone else has used your account.</li>
      </ul>

      <h2>What you may test</h2>
      <p>
        Only point DappDrill at apps you own, or that you have permission to test. You are responsible for that permission
        and for the test accounts, wallets and keys you give us. Use test accounts and test keys, never keys that hold real
        funds.
      </p>

      <h2>What you must not do</h2>
      <ul>
        <li>Use DappDrill to attack, overload, or get unauthorized access to any app, system or account.</li>
        <li>Use it to get around CAPTCHAs, bot checks or other access controls. DappDrill reports these as blocked and stops.</li>
        <li>Break the law, or the terms of the apps and services you test.</li>
        <li>Try to break, reverse engineer or overload DappDrill itself, or get into other customers’ data.</li>
        <li>Resell the service or let people outside your organization use your account without our written agreement.</li>
      </ul>
      <p>We may suspend accounts that do any of this.</p>

      <h2>Chains and funds</h2>
      <p>
        Tests run on local forks with test funds. DappDrill does not send transactions to mainnet, and it is not a wallet: we
        never hold, move or manage real assets for you. Where you set up live mode on a testnet, you supply the testnet key
        and are responsible for it.
      </p>

      <h2>Your content</h2>
      <p>
        What you bring to DappDrill and what your runs produce (apps, settings, tests, results, recordings) stays yours. You
        give us permission to store, process and show it as needed to provide the service to you and your team, including
        sending it to the service providers named in our <a href="/privacy/">privacy policy</a>. We don’t use it for anything
        else without asking.
      </p>

      <h2>Our service</h2>
      <p>
        DappDrill, its software, design and brand belong to {COMPANY.name}. These terms give you the right to use the service
        while your account is in good standing; they don’t transfer any ownership. If you send us feedback, we may use it
        freely.
      </p>

      <h2>Results are a help, not a guarantee</h2>
      <p>
        Tests are written and judged by software, including language models, and can be wrong. A passing run does not prove an
        app is free of bugs, and a failing one may be our mistake. DappDrill is not a security audit. Check what matters to
        you before you release, and don’t rely on DappDrill alone.
      </p>

      <h2>Fees</h2>
      <p>
        During early access DappDrill may be free. If we charge for a plan, the price and billing terms will be shown before
        you sign up for it, and we will give notice before changing them.
      </p>

      <h2>Other services</h2>
      <p>
        DappDrill relies on other services, such as chain RPC providers and the apps you test. We are not responsible for
        them, and their own terms apply to your use of them.
      </p>

      <h2>Disclaimer</h2>
      <p>
        The service is provided “as is” and “as available”. As far as the law allows, we make no warranties, express or
        implied, including that it will be uninterrupted, error-free, or fit for a particular purpose.
      </p>

      <h2>Limit of liability</h2>
      <p>
        As far as the law allows, we are not liable for indirect or consequential losses, such as lost profits, revenue, data
        or funds, or for losses caused by the apps you test or by relying on results. Our total liability for any claim about
        the service is limited to the greater of what you paid us in the 12 months before the claim and 100 euros. Nothing
        here limits liability that cannot be limited by law.
      </p>

      <h2>Indemnity</h2>
      <p>
        If someone makes a claim against us because of the apps you tested without permission, the content you gave us, or
        your breach of these terms, you will cover our reasonable costs of dealing with it.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop using DappDrill and close your account at any time. We may suspend or close an account that breaks these
        terms, or end the service with reasonable notice. After an account closes, we delete its data as described in the{" "}
        <a href="/privacy/">privacy policy</a>. The sections on content, disclaimer, liability and indemnity continue to apply.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms. We will change the date at the top and, for changes that matter, tell account holders by
        email before they take effect. Using DappDrill after that means you accept the new terms.
      </p>

      <h2>Law</h2>
      <p>
        These terms are governed by the laws of the country where {COMPANY.name} is registered, and its courts settle any
        dispute, unless the law where you live gives you the right to bring it there.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms go to {mail}.</p>
    </Doc>
  );
}
