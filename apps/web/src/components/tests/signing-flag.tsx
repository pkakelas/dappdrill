import { signingText, type SigningFlag as Flag } from "@dappdrill/core";
import { cx } from "@/components/ui";

/**
 * What the signing review flagged, next to a status and never part of it: Dangerous in bad,
 * Check this in warn, nothing at all when every signature looked consistent.
 */
export function SigningFlag({ signing, short, className }: { signing: Flag; short?: boolean; className?: string }) {
  const text = signingText(signing);
  if (!text) return null;
  const dangerous = signing.dangerous > 0;
  const tone = dangerous ? "text-bad" : "text-warn";
  if (short) {
    const label = dangerous ? `${signing.dangerous} dangerous` : `${signing.check} to check`;
    return (
      <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", dangerous ? "bg-bad-bg text-bad-ink" : "bg-warn-bg text-warn-ink", className)} title={text}>
        {label}
      </span>
    );
  }
  return <span className={cx(tone, className)}>{text}</span>;
}
