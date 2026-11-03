import type { PlanItem, ScanPlan } from "@dappdrill/core";
import Link from "next/link";
import { retryPlannedAction, skipPlannedAction } from "@/actions/scan";
import { ActionForm } from "@/components/action-form";
import { plural } from "@/lib/format";

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/\.*$/, ".");

/**
 * What the scan planned to test and what it couldn't record. Some flows always fail the first
 * time for reasons outside the app (a faucet limit, a missing key), so each one says why in a
 * line and offers a retry with a hint, or leaving it out of future scans.
 */
export function Coverage({ appId, scanId, plan, retrying, skipped }: { appId: string; scanId: string; plan: ScanPlan; retrying: Set<string>; skipped: Set<string> }) {
  const recorded = plan.items.filter((i) => i.outcome === "recorded");
  const failed = plan.items.filter((i) => i.outcome === "failed");
  const waiting = plan.items.filter((i) => i.outcome === "skipped").length;
  const unreached = plan.items.filter((i) => i.outcome === "not reached");
  const why = [...new Set(unreached.flatMap((i) => (i.note ? [i.note] : [])))].join(", ");
  if (!plan.items.length) return null;

  return (
    <section aria-labelledby="coverage" className="flex flex-col gap-3">
      <p id="coverage" className="m-0 text-[15px]">
        <strong className="font-semibold">
          {recorded.length === plan.items.length ? (recorded.length === 1 ? "The planned flow was recorded." : `All ${recorded.length} planned flows recorded.`) : `${recorded.length} of ${plural(plan.items.length, "planned flow")} recorded.`}
        </strong>{" "}
        <span className="text-ink-3">
          {recorded.map((i, n) => (
            <span key={i.name}>
              {n > 0 && ", "}
              {i.flowId ? <Link href={`/apps/${appId}/flows/${i.flowId}`}>{i.name}</Link> : i.name}
            </span>
          ))}
          {recorded.length > 0 && "."}
        </span>
      </p>

      {failed.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-divide border-y border-divide p-0">
          {failed.map((item) =>
            skipped.has(item.name) ? (
              <Skipped key={item.name} item={item} scanId={scanId} />
            ) : (
              <Failed key={item.name} item={item} appId={appId} scanId={scanId} retrying={retrying.has(item.name)} />
            ),
          )}
        </ul>
      )}

      {(waiting > 0 || unreached.length > 0) && (
        <p className="m-0 text-[13px] text-muted">
          {[
            waiting > 0 && `${waiting} more ${waiting === 1 ? "waits" : "wait"} on a flow that wasn't recorded`,
            unreached.length > 0 && `${unreached.length} ${unreached.length === 1 ? "wasn't" : "weren't"} reached${why ? ` (${why})` : ""}`,
          ]
            .filter(Boolean)
            .join(", and ")}
          .
        </p>
      )}
    </section>
  );
}

function Failed({ item, appId, scanId, retrying }: { item: PlanItem; appId: string; scanId: string; retrying: boolean }) {
  const reason = (
    <p className="m-0 text-sm text-muted">
      {sentence(item.note ?? "It couldn't be recorded")}
      {item.cause === "setup" && (
        <>
          {" "}
          <Link href={`/new?app=${appId}`} className="underline">
            Test setup
          </Link>
        </>
      )}
    </p>
  );
  if (retrying) {
    return (
      <li className="flex flex-col gap-1 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px]">{item.name}</span>
          <span className="flex items-center gap-2 text-[13px] text-muted">
            <span className="size-2 animate-pulse rounded-full bg-live" />
            Trying again
          </span>
        </div>
        {reason}
      </li>
    );
  }
  return (
    <li className="py-3">
      <details className="group">
        <summary className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[15px]">{item.name}</span>
            <span className="text-[13px] text-muted underline decoration-line-strong underline-offset-4 group-open:hidden">Add a hint</span>
          </span>
          {reason}
        </summary>
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <ActionForm action={retryPlannedAction} className="flex-[1_1_360px]">
            <input type="hidden" name="scanId" value={scanId} />
            <input type="hidden" name="name" value={item.name} />
            <div className="flex gap-2">
              <input name="hint" maxLength={1000} placeholder="Where to find it, or what to do differently (optional)" className="field min-w-0 flex-1" autoComplete="off" aria-label={`Hint for ${item.name}`} />
              <button type="submit" className="btn btn-sm btn-primary">
                Retry
              </button>
            </div>
          </ActionForm>
          <form action={skipPlannedAction}>
            <input type="hidden" name="scanId" value={scanId} />
            <input type="hidden" name="name" value={item.name} />
            <button type="submit" className="btn btn-sm">
              Don&apos;t test this
            </button>
          </form>
        </div>
      </details>
    </li>
  );
}

function Skipped({ item, scanId }: { item: PlanItem; scanId: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-3">
      <span className="text-[15px] text-muted">
        {item.name} <span className="text-[13px]">· left out of future scans</span>
      </span>
      <form action={skipPlannedAction}>
        <input type="hidden" name="scanId" value={scanId} />
        <input type="hidden" name="name" value={item.name} />
        <input type="hidden" name="undo" value="1" />
        <button type="submit" className="btn-link">
          Undo
        </button>
      </form>
    </li>
  );
}
