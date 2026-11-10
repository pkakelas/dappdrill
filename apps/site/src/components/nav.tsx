"use client";

import { useEffect, useState } from "react";
import { CTA, NAV } from "@/site";
import { Wordmark } from "./logo";

/** The floating bar. It turns light-on-dark while a dark section (data-dark) is behind it; `dark` is what the page starts with. */
export function Nav({ dark = true }: { dark?: boolean }) {
  const [onDark, setOnDark] = useState(dark);

  // Coming from another page (/#how, /#access), the browser's own jump to the section gets lost on load.
  useEffect(() => {
    if (location.hash.length > 1) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant" });
  }, []);

  useEffect(() => {
    const check = () => {
      const line = 44;
      setOnDark(
        [...document.querySelectorAll("[data-dark]")].some((el) => {
          const box = el.getBoundingClientRect();
          return box.top <= line && box.bottom > line;
        }),
      );
    };
    check();
    addEventListener("scroll", check, { passive: true });
    addEventListener("resize", check);
    return () => {
      removeEventListener("scroll", check);
      removeEventListener("resize", check);
    };
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-50 px-3 sm:top-4 sm:px-6">
      <nav
        data-on-dark={onDark}
        className="group pointer-events-auto mx-auto flex h-14 max-w-[1240px] items-center gap-8 rounded-full border border-ink/8 bg-white/85 pr-2 pl-5 text-ink shadow-[0_8px_30px_-18px_rgb(15_15_14/0.35)] backdrop-blur-md transition-colors duration-300 data-[on-dark=true]:border-white/10 data-[on-dark=true]:bg-white/6 data-[on-dark=true]:text-white data-[on-dark=true]:shadow-none"
      >
        <a href="/#top" aria-label="DappDrill">
          <Wordmark />
        </a>
        <div className="hidden items-center gap-7 text-[14.5px] opacity-75 md:flex">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="transition-opacity hover:opacity-60">
              {item.label}
            </a>
          ))}
        </div>
        <a
          href={CTA.href}
          className="ml-auto inline-flex h-10 items-center rounded-full bg-ink px-5 text-[14.5px] font-medium text-white transition-colors hover:bg-ink/85 group-data-[on-dark=true]:bg-white group-data-[on-dark=true]:text-ink group-data-[on-dark=true]:hover:bg-white/85"
        >
          {CTA.label}
        </a>
      </nav>
    </header>
  );
}
