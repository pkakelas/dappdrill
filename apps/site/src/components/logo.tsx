/** The mark: a ring with its right half filled. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill="var(--color-red)" />
    </svg>
  );
}

export function Wordmark({ size = 20 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2 text-[17px] font-semibold tracking-[-0.02em]">
      <Logo size={size} />
      DappDrill
    </span>
  );
}
