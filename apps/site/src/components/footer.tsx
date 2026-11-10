import { COMPANY, LEGAL, NAV } from "@/site";
import { Wordmark } from "./logo";

/** The last row of every page, on the dark closing band. */
export function Footer() {
  return (
    <footer className="wrap flex flex-wrap items-center gap-x-10 gap-y-4 border-t border-white/10 py-8 text-[14px] text-white/50">
      <a href="/#top" className="text-white" aria-label="DappDrill">
        <Wordmark size={18} />
      </a>
      {[...NAV, ...LEGAL].map((item) => (
        <a key={item.href} href={item.href} className="transition-colors hover:text-white">
          {item.label}
        </a>
      ))}
      <span className="sm:ml-auto">© 2026 {COMPANY.name}</span>
    </footer>
  );
}
