import type { Batch } from "@dappdrill/db";
import { cx } from "@/components/ui";

/** "5 of 6 passed, 1 failed", with Running while results are still coming in. Doesn't apply leaves the denominators. */
export function BatchStatus({ batch: b }: { batch: Batch }) {
  const applicable = b.total - b.skipped;
  const parts: React.ReactNode[] = [];
  if (b.active > 0) parts.push(<span key="live" className="text-live">{b.active === b.total ? (b.total === 1 ? "Running" : `Running ${b.total}`) : `${b.active} running`}</span>);
  if (applicable > 0 && b.active < b.total) parts.push(<span key="pass">{`${b.passed} of ${applicable} passed`}</span>);
  if (b.failed > 0) parts.push(<span key="fail" className="text-bad">{`${b.failed} failed`}</span>);
  if (b.couldntRun > 0) parts.push(<span key="err" className="text-warn">{`${b.couldntRun} couldn't run`}</span>);
  if (b.skipped > 0) parts.push(<span key="skip">{`${b.skipped} ${b.skipped === 1 ? "doesn't" : "don't"} apply`}</span>);
  const stopped = b.total - b.passed - b.failed - b.couldntRun - b.skipped - b.active;
  if (stopped > 0) parts.push(<span key="stop">{`${stopped} stopped`}</span>);
  return (
    <span className={cx("inline-flex flex-wrap gap-x-1")}>
      {parts.map((p, i) => (
        <span key={i} className="inline-flex gap-x-1">
          {i > 0 && <span aria-hidden="true">·</span>}
          {p}
        </span>
      ))}
    </span>
  );
}
