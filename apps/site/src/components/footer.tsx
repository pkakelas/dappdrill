import { COMPANY, PAGES, NAV } from "@/site";
import { Wordmark } from "./logo";

/** The last row of every page, on the dark closing band. Stacked on small screens: the logo, the home page sections
 *  and the other pages as two columns, then the copyright. One row from lg up. */
export function Footer() {
  return (
    <footer className="wrap flex flex-col gap-8 border-t border-white/10 py-10 text-[14px] text-white/50 lg:flex-row lg:items-center lg:gap-10 lg:py-8">
      <a href="/#top" className="self-start text-white lg:self-auto" aria-label="DappDrill">
        <Wordmark size={18} />
      </a>
      <nav className="grid grid-flow-col grid-rows-4 gap-x-10 gap-y-3 justify-start lg:flex lg:gap-x-8">
        {[...NAV, ...PAGES].map((item) => (
          <a key={item.href} href={item.href} className="transition-colors hover:text-white">
            {item.label}
          </a>
        ))}
      </nav>
      <span className="lg:ml-auto">© 2026 {COMPANY.name}</span>
    </footer>
  );
}
