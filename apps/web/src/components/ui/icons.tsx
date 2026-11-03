/** Icons are 1.6px strokes on a 14px grid, in currentColor. Keep them few. */

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** The site's mark: a circle, half filled. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 1.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </svg>
  );
}

function Stroke({ children, size = 14, className, width = 1.6 }: { children: React.ReactNode; size?: number; className?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
      <path d="M4 2.5v9l7-4.5z" />
    </svg>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <Stroke size={16} className={className}>
      <path d="M2 7h10M8 3l4 4-4 4" />
    </Stroke>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <Stroke className={className}>
      <path d="M3.5 5.5L7 9l3.5-3.5" />
    </Stroke>
  );
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <Stroke width={1.8} className={className}>
      <path d="M3 7.5l2.5 2.5L11 4.5" />
    </Stroke>
  );
}

export function CloseIcon({ className }: { className?: string }) {
  return (
    <Stroke className={className}>
      <path d="M3 3l8 8M11 3l-8 8" />
    </Stroke>
  );
}

export function PlusIcon({ className }: { className?: string }) {
  return (
    <Stroke className={className}>
      <path d="M7 2.5v9M2.5 7h9" />
    </Stroke>
  );
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <Stroke size={12} className={className}>
      <path d="M5.5 3H3v8h8V8.5M8 3h3v3M11 3L6.5 7.5" />
    </Stroke>
  );
}
