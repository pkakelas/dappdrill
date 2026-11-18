import type { makes, RepairState } from "@dappdrill/db";
import { TriangleAlert, Wrench } from "lucide-react";
import Link from "next/link";
import { cx } from "@/components/ui";
import { artifactUrl } from "@/lib/artifacts";
import { plainError, plural } from "@/lib/format";
import { BandBrowser, BandStatus } from "./make-band";
import { saidShort } from "./said";
import { Evidence } from "./signed";
import { StateMark, type TestState } from "./status";
import { Tile } from "./tile";

/** A row of `makes` that is a repair. */
export type RepairRow = typeof makes.$inferSelect & { state: { repair: RepairState } };
type Line = RepairState["tests"][number];

const MARK: Record<Line["status"], TestState> = { waiting: "never", repairing: "running", repaired: "passed", "not-repaired": "stopped" };
const WORD: Record<Line["status"], string> = { waiting: "Waiting", repairing: "Repairing", repaired: "Repaired", "not-repaired": "Not repaired" };
const TONE: Record<Line["status"], string> = { waiting: "", repairing: "text-live", repaired: "text-good", "not-repaired": "text-warn" };

/** The tests of a repair, each with what came of it. One that wasn't repaired says why under its name. */
function RepairList({ appId, tests }: { appId: string; tests: Line[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border/60">
      {tests.map((t) => (
        <li key={t.testId} className="relative flex items-start gap-3 px-2 py-2.5 text-sm hover:bg-foreground/5">
          <StateMark state={MARK[t.status]} label={WORD[t.status]} className="mt-0.5" />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Link href={`/apps/${appId}/tests/${t.testId}`} className={cx("text-pretty outline-none after:absolute after:inset-0 focus-visible:underline", t.status === "waiting" && "text-muted-foreground")}>
              {t.name}
            </Link>
            {t.status === "not-repaired" && t.why && <Evidence text={t.why} className="text-xs" textClassName="text-pretty text-muted-foreground" />}
          </div>
          <span className={cx("w-24 shrink-0 pt-0.5 text-right text-xs text-muted-foreground", TONE[t.status])}>{WORD[t.status]}</span>
        </li>
      ))}
    </ol>
  );
}

/** What a repair wrote besides its tests, as a sentence. */
function parts({ setup, reset }: RepairState): string | undefined {
  if (setup && reset) return "The setup and the reset were written as code.";
  return setup ? "The setup was written as code." : reset ? "The reset was written as code." : undefined;
}

/**
 * Tests being repaired, as it happens: what the browser sees, and each test with what came of it. It has
 * the shape of the band that shows while tests are made.
 */
export function RepairBand({ appId, appUrl, repair: row }: { appId: string; appUrl: string; repair: RepairRow }) {
  const { state } = row;
  const { tests } = state.repair;
  const queued = row.status === "queued";
  const frame = artifactUrl("makes", row.id, state.frame);
  const done = tests.filter((t) => t.status === "repaired" || t.status === "not-repaired").length;
  const current = tests.find((t) => t.status === "repairing");
  // The setup and the reset come before any test, and nothing names them while they are done.
  const headline = queued ? "Waiting for a browser" : current || done > 0 ? `${done} of ${plural(tests.length, "test")} repaired` : tests.length === 0 ? "Writing the setup as code" : "Starting with the setup";

  return (
    <section aria-label="Repairing tests" className="grid gap-8 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:gap-10">
      <BandBrowser url={appUrl} frame={frame} doing={queued ? "Waiting for a browser…" : state.said ? saidShort(state.said) : `${headline}…`} />

      <div className="flex min-w-0 flex-col gap-4 md:py-1">
        <BandStatus make={row}>{queued ? "Queued" : "Repairing tests"}</BandStatus>

        <div className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold tracking-tight">{headline}</h2>
          <p className="text-sm text-pretty text-muted-foreground">
            {state.repair.afterBatch ? "A run stopped at lines it had no working code for, so they are being written again. " : "Each line that isn't code, or whose code stopped working, is done in the browser and written as code again. "}
            The repaired tests are run once afterwards.
          </p>
        </div>

        {tests.length > 0 && (
          <div className="rounded-xl border border-dashed bg-card/60 p-1.5">
            <RepairList appId={appId} tests={tests} />
          </div>
        )}
      </div>
    </section>
  );
}

/** How the last repair ended: what was written as code, what wasn't and why, and the run that followed it. */
export function RepairOutcome({ appId, appUrl, repair: row }: { appId: string; appUrl: string; repair: RepairRow }) {
  const { repair } = row.state;
  const repaired = repair.tests.filter((t) => t.status === "repaired").length;
  const left = repair.tests.filter((t) => t.status !== "repaired");
  const wrote = parts(repair);
  const ok = row.status === "done" && left.length === 0;
  const title =
    row.status === "failed"
      ? "The repair didn't finish"
      : row.status === "stopped"
        ? "The repair was stopped"
        : repair.tests.length === 0
          ? (wrote ?? "Nothing needed repairing")
          : `${repaired} of ${plural(repair.tests.length, "test")} repaired`;
  const detail = [
    row.status === "failed" ? (row.error ? plainError(row.error, appUrl) : "Something went wrong on our side.") : undefined,
    repair.tests.length > 0 ? wrote : undefined,
    row.status === "stopped" && repaired > 0 ? "What was repaired by then is kept." : undefined,
  ].filter(Boolean);

  return (
    <section role="status" className="flex flex-col gap-4 rounded-xl border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <Tile icon={ok ? Wrench : TriangleAlert} tint={ok ? "good" : "warn"} />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-medium">{title}</h2>
          <p className="text-pretty text-muted-foreground">
            {detail.join(" ")}
            {detail.length > 0 && repair.batchId && " "}
            {repair.batchId && (
              <>
                They were run once afterwards:{" "}
                <Link href={`/apps/${appId}/runs/${repair.batchId}`} className="underline underline-offset-4 hover:text-foreground">
                  see that run
                </Link>
                .
              </>
            )}
          </p>
        </div>
      </div>
      {left.length > 0 && (
        <div className="rounded-xl border border-dashed p-1.5 sm:ml-12">
          <RepairList appId={appId} tests={left} />
        </div>
      )}
    </section>
  );
}
