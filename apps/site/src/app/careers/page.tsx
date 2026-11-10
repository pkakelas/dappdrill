import type { Metadata } from "next";
import { Doc } from "@/components/doc";
import { COMPANY } from "@/site";

export const metadata: Metadata = {
  title: "Careers · DappDrill",
  description: `Working at ${COMPANY.name} on DappDrill. No open roles right now.`,
};

export default function Careers() {
  return (
    <Doc
      label="Careers"
      title={
        <>
          No open roles <span className="text-ink/40">right now.</span>
        </>
      }
      intro={`We aren't hiring at the moment. When that changes, the roles will be listed here.`}
    >
      <h2>Still want to talk?</h2>
      <p>
        If you care about dApps that work, and testing them the way users break them, write to{" "}
        <a href={`mailto:${COMPANY.email}?subject=Careers`}>{COMPANY.email}</a> with a few lines about yourself and a link to
        your work. We will get in touch if a role opens that fits.
      </p>
    </Doc>
  );
}
