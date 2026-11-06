import { BUG_STATUS_LABEL, BUG_TRIAGE_LABEL, type ExploreBug } from "@dappdrill/core";
import { BadgeCheck, Bug, ChevronRight, CircleCheck, CircleDashed, CircleX, CloudOff, Compass, FlaskConical, Maximize2, Repeat2, ScanSearch, SquareTerminal, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrowserWindow } from "@/components/site-preview";
import { Tile, type TINT } from "@/components/tests/tile";
import { cx, SeverityTag } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AppBug } from "@/lib/explore";
import { plural } from "@/lib/format";
import { TriageSelect } from "./controls";

/** The tile takes the severity's colour once the bug held up; until then it stays quiet. */
const SEVERITY_TINT: Record<ExploreBug["severity"], keyof typeof TINT> = { critical: "bad", high: "bad", medium: "warn", low: "quiet" };

function Chip({ icon: Icon, tone, children }: { icon: LucideIcon; tone?: string; children: ReactNode }) {
  return (
    <Badge variant="outline" className="rounded-md font-normal text-muted-foreground">
      <Icon className={tone} aria-hidden="true" />
      {children}
    </Badge>
  );
}

/** A small heading over one part of the report. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

/** One side of expected against got, in its colour. */
function Side({ title, icon: Icon, tone, children }: { title: string; icon: LucideIcon; tone: "good" | "bad"; children: ReactNode }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-1.5 rounded-lg p-3", tone === "good" ? "bg-good-soft" : "bg-bad-soft")}>
      <h4 className={cx("flex items-center gap-1.5 text-xs font-medium", tone === "good" ? "text-good" : "text-bad")}>
        <Icon className="size-3.5" aria-hidden="true" />
        {title}
      </h4>
      <p className="text-pretty break-words">{children}</p>
    </section>
  );
}

/** One kind of log, scrolling inside once it gets long. A line that came up three times shows once, counted. */
function Log({ title, icon: Icon, tone, lines }: { title: string; icon: LucideIcon; tone: string; lines: string[] }) {
  if (lines.length === 0) return null;
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return (
    <div className="grid gap-x-6 gap-y-1.5 px-3 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <h4 className="flex items-center gap-1.5 self-start text-xs leading-relaxed text-muted-foreground">
        <Icon className={cx("size-3.5", tone)} aria-hidden="true" />
        {title}
      </h4>
      <ul tabIndex={0} aria-label={title} className="flex max-h-44 min-w-0 flex-col gap-1 overflow-y-auto overscroll-contain rounded-sm pr-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {[...counts].map(([line, n]) => (
          <li key={line} className="flex items-baseline gap-2">
            <span className="min-w-0 break-words whitespace-pre-wrap">{line}</span>
            {n > 1 && <span className="shrink-0 rounded bg-foreground/10 px-1 font-sans text-[11px] text-muted-foreground tabular-nums">×{n}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The page as it looked, in the app's browser window; it opens full size. Beside a taller report the
 * window grows to end level with it, and the screenshot is cropped from the top, as in the live view.
 */
function Shot({ src, name, appUrl }: { src: string; name: string; appUrl: string }) {
  const alt = `The page when it happened: ${name}`;
  return (
    <Dialog>
      <div className="grow">
        <BrowserWindow
          url={appUrl}
          toolbar={
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon-xs" aria-label="Show the screenshot full size">
                <Maximize2 aria-hidden="true" />
              </Button>
            </DialogTrigger>
          }
        >
          <DialogTrigger className="relative block aspect-[16/10] grow cursor-zoom-in bg-muted outline-none" tabIndex={-1} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="absolute inset-0 size-full object-cover object-top" />
          </DialogTrigger>
        </BrowserWindow>
      </div>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogTitle className="border-b px-4 py-3 text-sm font-medium">The page when it happened</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full" />
      </DialogContent>
    </Dialog>
  );
}

/** The report beside the page as it looked, ending level with it; then the review and what the browser logged. */
function Evidence({ bug, shot, appUrl }: AppBug & { appUrl: string }) {
  const { chain, console, network } = bug.evidence;
  const logged = chain.length + console.length + network.length > 0;
  const confirmed = bug.status === "confirmed";
  return (
    <details className="group/evidence text-sm">
      <summary className={cx(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5 w-fit text-muted-foreground")}>
        <ChevronRight className="transition-transform group-open/evidence:rotate-90" aria-hidden="true" />
        Steps and evidence
      </summary>
      <div className={cx("mt-2 grid gap-x-8 gap-y-5 border-t pt-4", shot && "lg:grid-cols-[minmax(0,1fr)_24rem]")}>
        <div className="flex min-w-0 flex-col gap-5">
          {bug.steps.length > 0 && (
            <Part title="Steps to reproduce">
              <ol className="flex flex-col">
                {bug.steps.map((s, i) => (
                  <li key={i} className="group/step relative flex gap-3 pb-3 last:pb-0">
                    {/* The line that ties a step to the next one. */}
                    <span className="absolute top-6 bottom-0 left-[11px] w-px bg-fork-line group-last/step:hidden" aria-hidden="true" />
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-fork-bg text-xs font-medium text-fork tabular-nums" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span className="min-w-0 pt-0.5 break-words">{s}</span>
                  </li>
                ))}
              </ol>
            </Part>
          )}
          {/* These two take up the slack when the screenshot is the taller side. */}
          <div className="grid grow gap-3 sm:grid-cols-2">
            <Side title="Expected" icon={CircleCheck} tone="good">
              {bug.expected}
            </Side>
            <Side title="Got" icon={CircleX} tone="bad">
              {bug.actual}
            </Side>
          </div>
        </div>
        {shot && (
          <Part title="The page when it happened">
            <Shot src={shot} name={bug.name} appUrl={appUrl} />
          </Part>
        )}
        {bug.reasoning && (
          <Alert role="note" className="border-transparent bg-live-soft lg:col-span-full">
            <ScanSearch className="text-live" aria-hidden="true" />
            <AlertTitle className="text-live-ink">{confirmed ? "What the fresh browser saw" : "Review"}</AlertTitle>
            <AlertDescription className="text-foreground/80">
              <p className="max-w-3xl text-pretty break-words">{bug.reasoning}</p>
            </AlertDescription>
          </Alert>
        )}
        {logged && (
          <div className="divide-y rounded-lg border bg-muted/40 lg:col-span-full">
            <Log title="Wallet and chain" icon={Wallet} tone="text-fork" lines={chain} />
            <Log title="Console errors" icon={SquareTerminal} tone="text-bad" lines={console} />
            <Log title="Failed requests" icon={CloudOff} tone="text-warn-icon" lines={network} />
          </div>
        )}
      </div>
    </details>
  );
}

function BugLine({ appUrl, ...entry }: AppBug & { appUrl: string }) {
  const { bug, passId, triage } = entry;
  const confirmed = bug.status === "confirmed";
  return (
    <li className="flex gap-3 p-4">
      <Tile icon={Bug} tint={confirmed ? SEVERITY_TINT[bug.severity] : "quiet"} />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-2">
            <h3 className="leading-snug font-medium text-pretty">{bug.name}</h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <SeverityTag severity={bug.severity} />
              {confirmed ? (
                <Chip icon={BadgeCheck} tone="text-live">
                  Confirmed in a fresh browser
                </Chip>
              ) : (
                <Chip icon={CircleDashed}>{BUG_STATUS_LABEL[bug.status]}</Chip>
              )}
              <Chip icon={Compass} tone="text-fork">
                {bug.feature}
              </Chip>
              {bug.seen > 1 && <Chip icon={Repeat2}>Seen {bug.seen} times</Chip>}
            </div>
          </div>
          <TriageSelect passId={passId} bugId={bug.id} value={triage} />
        </div>
        <p className="max-w-prose text-sm text-pretty">{bug.summary}</p>
        {triage === "accepted" && bug.steps.length > 0 && (
          <p className="flex w-fit items-center gap-1.5 rounded-md bg-good-soft px-2 py-1 text-sm text-good-ink">
            <FlaskConical className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              A{" "}
              <Link href="?show=drafts" className="underline underline-offset-4">
                draft test
              </Link>{" "}
              was written from it. It passes once the bug is fixed.
            </span>
          </p>
        )}
        <Evidence {...entry} appUrl={appUrl} />
      </div>
    </li>
  );
}

/** The app's bugs: things it did wrong that held up when tried again in a fresh browser. */
export function Bugs({ open, setAside, running, explored, appUrl }: { open: AppBug[]; setAside: AppBug[]; running: boolean; explored: boolean; appUrl: string }) {
  return (
    <div className="flex flex-col gap-4">
      {open.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {running ? "No bugs so far. One shows here once it has been reviewed and tried again in a fresh browser." : explored ? "No bugs held up when tried again in a fresh browser." : "Bugs show here once the app has been explored."}
        </p>
      ) : (
        <ul className="divide-y rounded-xl border bg-card shadow-sm">
          {open.map((b) => (
            <BugLine key={b.bug.id} {...b} appUrl={appUrl} />
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
