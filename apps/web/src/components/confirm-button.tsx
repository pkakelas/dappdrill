"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Destructive action that asks once, in place: the first click arms it for a few seconds.
 *  Unstyled: pass `buttonVariants(...)` or a menu class as className. */
export function ConfirmButton({ onConfirm, children, confirm = "Click again to delete", className }: { onConfirm: () => Promise<unknown>; children: ReactNode; confirm?: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      data-keep-open
      disabled={pending}
      className={cx(className, armed && "border-bad text-bad hover:text-bad")}
      onClick={() => (armed ? start(async () => void (await onConfirm())) : setArmed(true))}
    >
      {pending ? "Deleting…" : armed ? confirm : children}
    </button>
  );
}
