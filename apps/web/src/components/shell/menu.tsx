"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** A button that opens a small popover; closes on outside click, Escape, or navigation. */
export function Menu({
  label,
  button,
  children,
  align = "left",
  buttonClassName,
}: {
  label: string;
  button: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} className={buttonClassName} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div
          role="menu"
          onClick={(e) => (e.target as HTMLElement).closest("a,button") && setOpen(false)}
          className={cx(
            "absolute top-[calc(100%+6px)] z-40 flex w-[280px] max-w-[calc(100vw-32px)] flex-col rounded-xl border border-line bg-white py-1.5 shadow-[0_8px_24px_rgba(23,24,28,0.10)]",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("px-1.5", className)}>{children}</div>;
}

export const menuLinkClass = "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink no-underline hover:bg-sub";
