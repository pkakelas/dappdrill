import type { Metadata } from "next";
import { NewAppForm } from "@/components/new-app-form";

export const metadata: Metadata = { title: "New app" };

export default function NewAppPage() {
  return (
    <div className="page flex min-h-[70vh] flex-col justify-center gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="max-w-[18ch] text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Paste a URL. Get tests for what your users do.</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
          DappDrill uses your app with a test wallet for about two minutes, then writes tests for its main flows and runs them. Everything runs on a local fork; nothing touches mainnet.
        </p>
      </header>
      <div className="max-w-3xl">
        <NewAppForm />
      </div>
    </div>
  );
}
