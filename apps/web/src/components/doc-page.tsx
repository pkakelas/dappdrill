import Link from "next/link";
import { Logo } from "@/components/ui";

/** A public guide page (/bot, /fork): the site header, a title, a lead and sections. */
export function DocPage({ title, lead, children }: { title: string; lead: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-line">
        <div className="page flex items-center justify-between gap-3 py-3.5">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <Logo />
            <span className="font-serif text-[20px] tracking-[-0.02em]">DappDrill</span>
          </Link>
        </div>
      </header>
      <main className="page flex max-w-[720px] flex-col gap-9 py-10 text-[15px] leading-relaxed text-ink-2">
        <header className="flex flex-col gap-3">
          <h1 className="h1">{title}</h1>
          <p className="m-0 text-[17px] text-ink-3">{lead}</p>
        </header>
        {children}
      </main>
    </>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="h2">{title}</h2>
      {children}
    </section>
  );
}

export function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-sub px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
}
