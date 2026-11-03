import type { ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { ConfirmButton, SubmitButton } from "./client";
import { CheckIcon, cx } from "./icons";

/** Label (mono caps) over a control, with an optional hint or error under it. */
export function Field({ label, hint, error, aside, children, className }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        {aside}
      </span>
      {children}
      {error ? <span className="text-meta text-bad">{error}</span> : hint ? <span className="meta">{hint}</span> : null}
    </label>
  );
}

/** Checkbox with a label and an optional line of explanation. */
export function Checkbox({ label, description, className, ...input }: { label: ReactNode; description?: ReactNode; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-2.5 text-sm text-ink-2", className)}>
      <input type="checkbox" className="check mt-0.5" {...input} />
      <span>
        {label}
        {description && <span className="meta block">{description}</span>}
      </span>
    </label>
  );
}

/** A toggle chip: a checkbox that reads as a pill. Filled with a check when on. */
export function Chip({ children, className, ...input }: { children: ReactNode; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx("chip group/chip", className)}>
      <input type="checkbox" className="sr-only" {...input} />
      <span className="hidden group-has-[:checked]/chip:inline-flex">
        <CheckIcon />
      </span>
      {children}
    </label>
  );
}

export function Hidden({ fields }: { fields: Record<string, string | number | null | undefined> }) {
  return (
    <>
      {Object.entries(fields).map(([k, v]) => (v === null || v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
    </>
  );
}

/** One server action as one button: hidden fields, a pending state, and (with `confirm`) a second click for destructive ones. */
export function ActionButton({
  action,
  fields = {},
  children,
  className,
  pendingText,
  confirm,
  disabled,
  formClassName,
  "aria-label": ariaLabel,
}: {
  action: (form: FormData) => void | Promise<void>;
  fields?: Record<string, string | number | null | undefined>;
  children: ReactNode;
  className?: string;
  pendingText?: ReactNode;
  confirm?: ReactNode;
  disabled?: boolean;
  formClassName?: string;
  "aria-label"?: string;
}) {
  return (
    <form action={action} className={formClassName}>
      <Hidden fields={fields} />
      {confirm ? (
        <ConfirmButton className={className} confirm={confirm} disabled={disabled} aria-label={ariaLabel}>
          {children}
        </ConfirmButton>
      ) : (
        <SubmitButton className={className} pendingText={pendingText} disabled={disabled} aria-label={ariaLabel}>
          {children}
        </SubmitButton>
      )}
    </form>
  );
}

/** The error / success line under a form. */
export function FormMessage({ state }: { state: ActionResult | { error?: string; ok?: string } }) {
  if (!state || (!state.error && !state.ok)) return null;
  return (
    <p role={state.error ? "alert" : "status"} className={cx("m-0 text-meta", state.error ? "text-bad" : "text-muted")}>
      {state.error ?? state.ok}
    </p>
  );
}
