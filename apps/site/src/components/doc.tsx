import type { ReactNode } from "react";
import { Footer } from "./footer";
import { Nav } from "./nav";

/** A plain reading page (About, Privacy): the floating nav, a title, a narrow column of text, the footer. */
export function Doc({ label, title, intro, children }: { label: string; title: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Nav dark={false} />
      <main className="wrap pt-[clamp(140px,18vh,200px)] pb-[clamp(96px,12vw,150px)]">
        <p className="label text-ink/50">{label}</p>
        <h1 className="display mt-6 max-w-[18ch] text-[clamp(40px,5.6vw,76px)]">{title}</h1>
        {intro && <p className="mt-7 max-w-[52ch] text-[clamp(17px,1.4vw,20px)] leading-[1.5] text-pretty text-ink/65">{intro}</p>}
        <div className="doc mt-[clamp(56px,7vw,96px)] max-w-[68ch]">{children}</div>
      </main>
      <div data-dark className="bg-ink">
        <Footer />
      </div>
    </>
  );
}
