"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { cx } from "@/components/ui";

/** Destructive action that asks once, in place: the first click arms it for a few seconds.
 *  An action that answers `{ error }` has it shown beside the button.
 *  Unstyled: pass `buttonVariants(...)` or a menu class as className. */
export function ConfirmButton({
  onConfirm,
  children,
  confirm = "Click again to delete",
  busy = "Deleting…",
  className,
}: {
  onConfirm: () => Promise<unknown>;
  children: ReactNode;
  confirm?: string;
  /** Shown while it runs. */
  busy?: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const run = () =>
    start(async () => {
      const said = (await onConfirm()) as { error?: unknown } | null | undefined;
      setArmed(false);
      setError(typeof said?.error === "string" ? said.error : undefined);
    });
  return (
    <>
      {error && (
        <span role="alert" className="text-xs text-bad">
          {error}
        </span>
      )}
      <button type="button" data-keep-open disabled={pending} className={cx(className, armed && "border-bad text-bad hover:text-bad")} onClick={() => (armed ? run() : setArmed(true))}>
        {pending ? busy : armed ? confirm : children}
      </button>
    </>
  );
}
