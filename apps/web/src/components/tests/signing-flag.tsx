import { signingText, type SigningFlag as Flag } from "@dappdrill/core";
import { cx } from "@/components/ui";

/**
 * What the signing review flagged, next to a status and never part of it: Dangerous in bad,
 * Check this in warn, nothing at all when every signature looked consistent.
 */
export function SigningFlag({ signing, short, className }: { signing: Flag; short?: boolean; className?: string }) {
  const text = signingText(signing);
  if (!text) return null;
  const tone = signing.dangerous > 0 ? "text-bad" : "text-warn";
  if (short) {
    const label = signing.dangerous > 0 ? `${signing.dangerous} dangerous` : `${signing.check} to check`;
    return (
      <span className={cx("shrink-0 text-xs font-medium", tone, className)} title={text}>
        {label}
      </span>
    );
  }
  return <span className={cx(tone, className)}>{text}</span>;
}
