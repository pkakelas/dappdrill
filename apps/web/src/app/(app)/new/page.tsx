import type { Metadata } from "next";
import { NewAppForm } from "@/components/new-app-form";

export const metadata: Metadata = { title: "New app" };

export default function NewAppPage() {
  return (
    <div className="page flex min-h-[70vh] flex-col justify-center gap-8">
      <header className="flex flex-col gap-3">
        <h1 className="h1 max-w-[18ch]">Paste a URL. Get tests for what your users do.</h1>
        <p className="m-0 max-w-[600px] text-[17px] leading-relaxed text-ink-3">
          DappDrill uses your app with a test wallet for about two minutes, then writes tests for its main flows and runs them. Everything runs on a local fork; nothing touches mainnet.
        </p>
      </header>
      <div className="max-w-[720px]">
        <NewAppForm />
      </div>
    </div>
  );
}
