import Link from "next/link";
import { Logo } from "@/components/ui";

/** A public guide page (/bot, /fork): the site header, a title, a lead and sections. */
export function DocPage({ title, lead, children }: { title: string; lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Logo size={18} />
            <span className="font-semibold">DappDrill</span>
          </Link>
        </div>
      </header>
      <main className="page flex max-w-3xl flex-col gap-9 py-10 text-base leading-relaxed">
        <header className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-lg text-muted-foreground">{lead}</p>
        </header>
        {children}
      </main>
    </>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{children}</code>;
}
