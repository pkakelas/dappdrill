"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CHAINS, STEPS } from "@/site";

/**
 * The steps. On a wide screen the section pins while you scroll through it: the list on the left
 * moves down a step at a time and the picture on the right changes with it. On a narrow one it is
 * simply one block per step, each with its picture.
 */
export function Steps({ pictures }: { pictures: ReactNode[] }) {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = section.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const span = box.height - innerHeight;
      if (span <= 0) return;
      const progress = Math.min(0.999, Math.max(0, -box.top / span));
      setActive(Math.floor(progress * STEPS.length));
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => {
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  /** Scroll to the middle of a step's share of the pinned section. */
  const go = (i: number) => {
    const el = section.current;
    if (!el) return;
    const span = el.offsetHeight - innerHeight;
    scrollTo({ top: el.offsetTop + (span * (i + 0.5)) / STEPS.length });
  };

  return (
    <section id="how" ref={section} className="relative scroll-mt-24 lg:h-[470vh] lg:scroll-mt-0">
      <div className="wrap relative py-24 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:justify-center lg:py-0">
        <p className="label mb-10 text-ink/50 lg:absolute lg:top-28 lg:mb-0">How it works</p>
        <ol className="lg:w-[32%]">
          {STEPS.map((step, i) => (
            <li key={step.name} data-step data-active={i === active} className="group mb-20 last:mb-0 lg:mb-0">
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === active ? "step" : undefined}
                className="block w-full cursor-default text-left transition-opacity duration-500 lg:cursor-pointer lg:py-3 lg:opacity-25 lg:group-data-[active=true]:opacity-100 lg:hover:opacity-60"
              >
                <span className="flex items-baseline gap-4">
                  <span className="font-mono text-[13px] text-red">0{i + 1}</span>
                  <span className="display text-[clamp(40px,4.4vw,64px)]">{step.name}</span>
                </span>
              </button>
              <div className="grid transition-[grid-template-rows,opacity] duration-500 lg:grid-rows-[0fr] lg:opacity-0 lg:group-data-[active=true]:grid-rows-[1fr] lg:group-data-[active=true]:opacity-100">
                <div className="overflow-hidden">
                  <p className="mt-4 max-w-[34ch] text-[17px] leading-[1.5] text-pretty text-ink/65 lg:mt-1 lg:pb-5 lg:pl-[37px]">{step.line}</p>
                  {step.name === "Run" && <Chains />}
                </div>
              </div>
              <div className="mt-8 transition-opacity duration-500 lg:pointer-events-none step-picture lg:absolute lg:top-1/2 lg:left-[38%] lg:mt-0 lg:-translate-y-1/2 lg:opacity-0 lg:group-data-[active=true]:pointer-events-auto lg:group-data-[active=true]:opacity-100">
                {pictures[i]}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Chains() {
  return (
    <div className="mt-4 flex items-center gap-3 lg:mt-0 lg:pb-5 lg:pl-[37px]">
      <span className="flex gap-1.5">
        {CHAINS.map((chain) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={chain.icon} src={`/icons/${chain.icon}.svg`} alt={chain.name} title={chain.name} width={20} height={20} className="size-5" />
        ))}
      </span>
      <span className="text-[13.5px] text-ink/55">Forks of six chains today</span>
    </div>
  );
}
