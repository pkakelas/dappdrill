import type { Batch } from "@dappdrill/db";

/** "5 of 6 passed · 1 failed", with Running while results are still coming in. */
export function BatchStatus({ batch: b }: { batch: Batch }) {
  const parts: React.ReactNode[] = [];
  if (b.active > 0) parts.push(<span className="text-live">{b.active === b.total ? (b.total === 1 ? "Running" : `Running ${b.total}`) : `${b.active} running`}</span>);
  if (b.active < b.total) parts.push(<span>{`${b.passed} of ${b.total} passed`}</span>);
  if (b.failed > 0) parts.push(<span className="text-bad">{`${b.failed} failed`}</span>);
  if (b.unverified > 0) parts.push(<span className="text-warn">{`${b.unverified} couldn't be verified`}</span>);
  const stopped = b.total - b.passed - b.failed - b.unverified - b.active;
  if (stopped > 0) parts.push(<span>{`${stopped} stopped`}</span>);
  return (
    <span className="inline-flex flex-wrap gap-x-1">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex gap-x-1">
          {i > 0 && <span aria-hidden="true">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}
