import type { Metadata } from "next";
import { Doc } from "@/components/doc";
import { COMPANY } from "@/site";

export const metadata: Metadata = {
  title: "About DappDrill",
  description: `DappDrill is made by ${COMPANY.name}, a company building software products we believe are useful.`,
};

export default function About() {
  return (
    <Doc
      label="About"
      title={
        <>
          DappDrill is made by <span className="text-ink/40">{COMPANY.name}.</span>
        </>
      }
      intro="We build software-as-a-service products that we believe are useful: tools for the work we kept doing by hand."
    >
      <h2>Why DappDrill</h2>
      <p>
        Before every release of a dApp, someone clicks through it with a wallet: deposit, withdraw, switch network, reject a
        signature, try again. It is slow, it is easy to skip a case, and the cases people skip are the ones users hit.
      </p>
      <p>
        DappDrill does that pass for you. It finds the flows that matter, writes a test for each, and runs them on local forks
        of the chain with its own wallet, including the odd cases. You get a short report of what broke, with a video of it
        happening.
      </p>

      <h2>How we work</h2>
      <ul>
        <li>We build what we would use ourselves, and keep it plain.</li>
        <li>We test on forks with fake money. DappDrill never sends a transaction to mainnet.</li>
        <li>We collect only what a product needs to work. The <a href="/privacy/">privacy policy</a> says what that is.</li>
      </ul>

      <h2>Talk to us</h2>
      <p>
        For early access, questions or anything else, write to <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>.
      </p>
    </Doc>
  );
}
