"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { cx } from "./icons";

type ButtonProps = { children: ReactNode; className?: string; disabled?: boolean; name?: string; value?: string; "aria-label"?: string };

/** Submit button that shows it's working while its form's action runs. Always a .btn. */
export function SubmitButton({ children, className, pendingText, disabled, ...rest }: ButtonProps & { pendingText?: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={cx("btn", className)} disabled={pending || disabled} aria-busy={pending || undefined} {...rest}>
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** Destructive submit: the first click arms it ("Archive?"), the second submits. Disarms after a few seconds or on blur. */
export function ConfirmButton({ children, confirm, className, disabled, ...rest }: ButtonProps & { confirm: ReactNode }) {
  const { pending } = useFormStatus();
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      // Always a submit button: swapping `type` on the first click lets React's
      // synchronous re-render turn that same click into a submit.
      type="submit"
      data-armed={armed || undefined}
      className={cx("btn btn-danger", className)}
      disabled={pending || disabled}
      onClick={(e) => {
        if (armed) return;
        e.preventDefault();
        setArmed(true);
      }}
      onBlur={() => setArmed(false)}
      {...rest}
    >
      {pending ? "…" : armed ? confirm : children}
    </button>
  );
}

/**
 * A button that opens a small floating panel; closes on outside click, Escape,
 * or (for menus) any link or button inside. Use for menus and short forms.
 */
export function Popover({
  label,
  button,
  children,
  align = "left",
  buttonClassName,
  panelClassName,
  menu,
}: {
  label: string;
  button: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
  panelClassName?: string;
  /** Menu: closes when an item is chosen. Otherwise it stays open (forms). */
  menu?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label={label} aria-expanded={open} aria-haspopup={menu ? "menu" : "dialog"} className={buttonClassName} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && (
        <div
          role={menu ? "menu" : "dialog"}
          aria-label={label}
          onClick={menu ? (e) => (e.target as HTMLElement).closest("a,button") && setOpen(false) : undefined}
          className={cx(
            "popover absolute top-[calc(100%+6px)] w-[280px] max-w-[calc(100vw-32px)]",
            menu ? "flex flex-col py-1.5" : "p-5",
            align === "right" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
