import type { Metadata } from "next";
import { Code, DocPage, Section } from "@/components/doc-page";

export const metadata: Metadata = {
  title: "Testing on a fork",
  description: "Why a dApp's data can fail to load on DappDrill's test chain, and how to point it at the fork.",
};

export default function ForkPage() {
  return (
    <DocPage
      title="Testing on a fork"
      lead="DappDrill runs your app against a local copy of the chain, so its transactions never touch real funds. That only works if the app reads from the copy too."
    >
      <Section title="What DappDrill routes for you">
        <p className="m-0">
          Every JSON-RPC call your page makes, to any provider (Infura, Alchemy, a public node, your own proxy), is answered by the fork. So is everything the wallet does. Apps that read the chain
          only through RPC need no setup.
        </p>
      </Section>

      <Section title="When the data doesn't load">
        <p className="m-0">If DappDrill can&apos;t explore or run a test because the app never finished loading, it says what the app was waiting on. There are two usual causes.</p>
        <ul className="m-0 flex flex-col gap-2.5 pl-5">
          <li>
            <strong>The fork&apos;s upstream gave up.</strong> The fork pulls state from an RPC the first time each contract is read. Public endpoints rate-limit or time out on a real dApp&apos;s
            multicalls, and some drop old block state within minutes. Fork from a dedicated or archive RPC: in the app&apos;s Settings, under Chains, choose <strong>Other chain</strong> and paste your RPC URL.
          </li>
          <li>
            <strong>The app reads from its own backend.</strong> Markets, balances and prices often come from an indexer, a GraphQL API or a price service. Those read the real chain, so they disagree
            with the fork or fail outright.
          </li>
        </ul>
      </Section>

      <Section title="Pointing your app at the fork">
        <ul className="m-0 flex flex-col gap-2.5 pl-5">
          <li>
            <strong>Test a build you control.</strong> Most apps take their RPC URL and backend URLs from build settings. In a preview or CI build, point the RPC at any URL (DappDrill answers it) and
            the backends at a staging indexer that follows a testnet, or turn them off.
          </li>
          <li>
            <strong>Turn on a fork mode.</strong> If your app has a fork or debug mode that it reads from localStorage, add it under <strong>Fork setup</strong> in the app&apos;s Settings, one{" "}
            <Code>key=value</Code> per line. DappDrill sets it on your app&apos;s origin before the app loads.
          </li>
          <li>
            <strong>Answer a request yourself.</strong> A version check, a feature-flag file or a backend that blocks the page can get a fixed body: one <Code>URL [status] body</Code> per line under
            Fork setup. <Code>*</Code> matches anything in the URL. Keep these few; a faked backend stops testing what your users see.
          </li>
          <li>
            <strong>Test on a testnet.</strong> When the backend can&apos;t be pointed anywhere else, add a testnet the backend already follows as a live chain, with a funded test key.
          </li>
        </ul>
      </Section>
    </DocPage>
  );
}
