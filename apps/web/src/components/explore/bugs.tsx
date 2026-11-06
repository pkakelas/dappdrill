import { BUG_STATUS_LABEL, BUG_TRIAGE_LABEL, type ExploreBug } from "@dappdrill/core";
import { Bug } from "lucide-react";
import Link from "next/link";
import { Tile } from "@/components/tests/tile";
import { cx } from "@/components/ui";
import type { AppBug } from "@/lib/explore";
import { plural } from "@/lib/format";
import { TriageSelect } from "./controls";

const SEVERITY_TEXT: Record<ExploreBug["severity"], string> = { critical: "text-bad", high: "text-bad", medium: "text-warn", low: "text-muted-foreground" };

function Evidence({ bug, shot }: AppBug) {
  const lines = [...bug.evidence.chain, ...bug.evidence.console, ...bug.evidence.network.map((h) => `Requests failed: ${h}`)];
  return (
    <details className="group/evidence text-sm">
      <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <span className="group-open/evidence:hidden">Steps and evidence</span>
        <span className="hidden group-open/evidence:inline">Hide steps and evidence</span>
      </summary>
      <div className="flex flex-col gap-4 pt-4">
        {bug.steps.length > 0 && (
          <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
            {bug.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        )}
        <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Expected</dt>
          <dd>{bug.expected}</dd>
          <dt className="text-muted-foreground">Got</dt>
          <dd>{bug.actual}</dd>
          {bug.reasoning && (
            <>
              <dt className="text-muted-foreground">Review</dt>
              <dd>{bug.reasoning}</dd>
            </>
          )}
        </dl>
        {lines.length > 0 && <pre className="overflow-x-auto rounded-lg bg-muted/60 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{lines.join("\n")}</pre>}
        {shot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot} alt={`The page when it happened: ${bug.name}`} className="w-full max-w-xl rounded-lg border" />
        )}
      </div>
    </details>
  );
}

function BugLine(entry: AppBug) {
  const { bug, passId, triage } = entry;
  const confirmed = bug.status === "confirmed";
  return (
    <li className="flex gap-3 p-4">
      <Tile icon={Bug} tint={confirmed ? "bad" : "quiet"} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h3 className="font-medium text-pretty">{bug.name}</h3>
            <p className="flex flex-wrap gap-x-1.5 text-xs text-muted-foreground">
              <span className={cx("capitalize", SEVERITY_TEXT[bug.severity])}>{bug.severity}</span>
              <span aria-hidden="true">·</span>
              <span>{confirmed ? "Confirmed in a fresh browser" : BUG_STATUS_LABEL[bug.status]}</span>
              <span aria-hidden="true">·</span>
              <span>{bug.feature}</span>
              {bug.seen > 1 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Seen {bug.seen} times</span>
                </>
              )}
            </p>
          </div>
          <TriageSelect passId={passId} bugId={bug.id} value={triage} />
        </div>
        <p className="text-sm text-pretty">{bug.summary}</p>
        {triage === "accepted" && bug.steps.length > 0 && (
          <p className="text-sm text-muted-foreground">
            A{" "}
            <Link href="?show=drafts" className="underline underline-offset-4 hover:text-foreground">
              draft test
            </Link>{" "}
            was written from it. It passes once the bug is fixed.
          </p>
        )}
        <Evidence {...entry} />
      </div>
    </li>
  );
}

/** The app's bugs: things it did wrong that held up when tried again in a fresh browser. */
export function Bugs({ open, setAside, running, explored }: { open: AppBug[]; setAside: AppBug[]; running: boolean; explored: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {open.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {running ? "No bugs so far. One shows here once it has been reviewed and tried again in a fresh browser." : explored ? "No bugs held up when tried again in a fresh browser." : "Bugs show here once the app has been explored."}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-sm">
          {open.map((b) => (
            <BugLine key={b.bug.id} {...b} />
          ))}
        </ul>
      )}
      {setAside.length > 0 && (
        <details className="px-1 text-sm">
          <summary className="w-fit cursor-pointer rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{plural(setAside.length, "report")} set aside</summary>
          <ul className="flex flex-col gap-3 pt-3">
            {setAside.map(({ bug, triage, passId }) => (
              <li key={bug.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <p className="min-w-0 flex-1 basis-80 text-pretty">
                  {bug.name}
                  <span className="text-muted-foreground">
                    {" · "}
                    {triage === "open" ? BUG_STATUS_LABEL[bug.status] : BUG_TRIAGE_LABEL[triage]}
                    {triage === "open" && bug.reasoning && ` · ${bug.reasoning}`}
                  </span>
                </p>
                {triage !== "open" && <TriageSelect passId={passId} bugId={bug.id} value={triage} />}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
