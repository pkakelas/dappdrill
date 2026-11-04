import type { Metadata } from "next";
import { NewAppForm } from "@/components/new-app-form";

export const metadata: Metadata = { title: "New app" };

export default function NewAppPage() {
  return (
    <div className="page flex flex-col gap-6 pt-12 sm:gap-8 sm:pt-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">New app</p>
        <h1 className="max-w-[18ch] text-3xl font-semibold tracking-tight text-balance sm:text-4xl">Turn your dApp&apos;s main flows into tests.</h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          DappDrill explores your app with a test wallet, writes tests for the flows it finds, and runs them. Usually takes about two minutes.
        </p>
      </header>
      <div className="flex max-w-3xl flex-col gap-4">
        <NewAppForm />
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>Mainnets run on local forks</span>
          <span aria-hidden="true">·</span>
          <span>Testnets can fork or run live</span>
          <span aria-hidden="true">·</span>
          <span>Every signature reviewed</span>
        </p>
      </div>
    </div>
  );
}
