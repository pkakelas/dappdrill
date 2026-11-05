import type { Metadata } from "next";
import { HowItWorks } from "@/components/how-it-works";
import { NewAppForm } from "@/components/new-app-form";
import { currentOrg } from "@/lib/session";

export const metadata: Metadata = { title: "New app" };

export default async function NewAppPage() {
  const { org } = await currentOrg();
  return (
    <div className="page pt-10 sm:pt-16">
      <div className="flex flex-col gap-8">
        <header className="mx-auto flex max-w-xl flex-col gap-2 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Add your dApp</h1>
          <p className="text-base text-balance text-muted-foreground">Paste its URL and DappDrill writes tests for what users do there.</p>
        </header>
        <NewAppForm orgId={org.id}>
          <HowItWorks className="pt-2" />
        </NewAppForm>
      </div>
    </div>
  );
}
