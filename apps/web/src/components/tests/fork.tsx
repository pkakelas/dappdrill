"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { forkTestAction } from "@/actions/tests";

/** "Fork": a copy of this test with one change, described in a sentence. Opens as a popover under the button. */
export function Fork({ testId }: { testId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Fork
      </button>
      {open && (
        <form
          className="absolute top-full right-0 z-20 mt-2 flex w-[min(440px,calc(100vw-32px))] flex-col gap-3 rounded-xl border border-line-strong bg-card p-4 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.3)]"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await forkTestAction(testId, text);
              if (r?.error) setError(r.error);
            });
          }}
        >
          <label htmlFor="fork" className="text-[14.5px]">
            The same test, but…
          </label>
          <input
            id="fork"
            autoFocus
            value={text}
            disabled={pending}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            placeholder="a limit sell instead of a market buy"
            className="field h-10"
          />
          {error ? <p className="m-0 text-[13px] text-bad">{error}</p> : <p className="hint m-0 text-[13px]">The copy keeps what matches, rewrites what differs, then runs.</p>}
          <button type="submit" className="btn btn-sm btn-primary w-fit" disabled={pending || text.trim().length < 3}>
            {pending ? "Forking…" : "Fork and run"}
          </button>
        </form>
      )}
    </div>
  );
}
