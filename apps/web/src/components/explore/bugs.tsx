import { BUG_STATUS_LABEL, type SecondLook } from "@dappdrill/core";
import { BadgeCheck, Bug, ChevronRight, CircleCheck, CircleDashed, CircleX, CloudOff, Compass, ListChecks, Maximize2, Repeat2, ScanSearch, SquareTerminal, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrowserWindow } from "@/components/site-preview";
import { cx, SeverityTag } from "@/components/ui";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AppBug, BugTest } from "@/lib/explore";
import { plural } from "@/lib/format";
import { AddBugTest, BugActions } from "./controls";

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

/** What the second look made of it, in the look's own words. */
function Saw({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Alert role="note" className="border-transparent bg-live-soft lg:col-span-full">
      <ScanSearch className="text-live" aria-hidden="true" />
      <AlertTitle className="text-live-ink">{title}</AlertTitle>
      <AlertDescription className="text-foreground/80">
        <p className="max-w-3xl text-pretty break-words">{children}</p>
      </AlertDescription>
    </Alert>
  );
}

/** Expected against got, side by side. */
function Sides({ expected, actual, className }: { expected: string; actual: string; className?: string }) {
  return (
    <div className={cx("grid gap-3 sm:grid-cols-2", className)}>
      <Side title="Expected" icon={CircleCheck} tone="good">
        {expected}
      </Side>
      <Side title="Got" icon={CircleX} tone="bad">
        {actual}
      </Side>
    </div>
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
          <Sides expected={bug.expected} actual={bug.actual} className="grow" />
        </div>
        {shot && (
          <Part title="The page when it happened">
            <Shot src={shot} name={bug.name} appUrl={appUrl} />
          </Part>
        )}
        {bug.reasoning && <Saw title={confirmed ? "What the fresh browser saw" : "Review"}>{bug.reasoning}</Saw>}
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

/** The test a bug belongs with: the one that found it, or the one that checks it now. */
export interface BugsTest {
  id: string;
  name: string;
}

/**
 * A bug as a line of the Bugs list: what is wrong, and under it who found it. Closed it is one
 * line; open it is the report. `action` is what can be done from the line without opening it.
 */
function BugLine({ id, name, source, meta, action, dashed, open, children }: { id: string; name: string; source: ReactNode; meta?: ReactNode; action?: ReactNode; dashed?: boolean; open?: boolean; children: ReactNode }) {
  return (
    <li id={id} className="scroll-mt-24 p-1.5">
      <details open={open} className="group/bug">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-2 py-2 transition-colors outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <span className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-rose-600", dashed ? "border border-dashed border-rose-500/50" : "bg-rose-500/10")}>
            <Bug className="size-4" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="min-w-0 font-medium text-pretty">{name}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">{source}</span>
          </span>
          {meta}
          {action}
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/bug:rotate-90" aria-hidden="true" />
        </summary>
        <div className="flex flex-col gap-3 pt-1.5 pr-2 pb-3 pl-12 text-sm">{children}</div>
      </details>
    </li>
  );
}

/** "Found by the test …", with the way to it. */
function ByTest({ appId, test, children }: { appId: string; test: BugsTest; children: ReactNode }) {
  return (
    <>
      <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
      <Link href={`/apps/${appId}/tests/${test.id}`} className="min-w-0 truncate rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {test.name}
      </Link>
    </>
  );
}

/** What a second look found wrong with the app. A look that named no bug gets the test's own expected result and failure. */
export const lookBug = (look: SecondLook, expected: string, failure?: string) => look.bug ?? { name: "The app did the wrong thing", expected, actual: failure ?? "Something else." };

/** The bug a second look confirmed, as a report: expected against got, then what the fresh browser saw. */
export function LookReport({ look, expected, failure }: { look: SecondLook; expected: string; failure?: string }) {
  const bug = lookBug(look, expected, failure);
  return (
    <>
      <Sides expected={bug.expected} actual={bug.actual} />
      {look.reason && <Saw title="What the fresh browser saw">{look.reason}</Saw>}
    </>
  );
}

/** A bug a test found: it failed, and a second look by hand in a fresh browser said the app is wrong. */
export function TestBug({ appId, test, look, expected, failure, open }: { appId: string; test: BugsTest; look: SecondLook; expected: string; failure?: string; open?: boolean }) {
  return (
    <BugLine
      id={test.id}
      name={lookBug(look, expected, failure).name}
      open={open}
      source={
        <ByTest appId={appId} test={test}>
          From the test
        </ByTest>
      }
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip icon={BadgeCheck} tone="text-live">
          Confirmed in a fresh browser
        </Chip>
      </div>
      <LookReport look={look} expected={expected} failure={failure} />
    </BugLine>
  );
}

/**
 * A bug the explorers found. One found while trying a test (`byTest`) belongs to that test; the
 * rest came from a check, which runs once, so nothing looks at them again until a test is added.
 */
export function ExploredBug({ appId, appUrl, linked, byTest, open, ...entry }: AppBug & { appId: string; appUrl: string; linked?: BugsTest; byTest?: boolean; open?: boolean }) {
  const { bug, passId, triage, title } = entry;
  const confirmed = bug.status === "confirmed";
  const from = bug.source === "signing" ? "From a signature check" : "From a check";
  return (
    <BugLine
      id={bug.id}
      name={bug.name}
      open={open}
      dashed={!confirmed}
      meta={<SeverityTag severity={bug.severity} />}
      action={!linked && bug.steps.length > 0 && <AddBugTest passId={passId} bugId={bug.id} label={byTest && title ? "Save the test" : "Add a test"} />}
      source={
        byTest && linked ? (
          <ByTest appId={appId} test={linked}>
            From the test
          </ByTest>
        ) : byTest && title ? (
          <>
            <ListChecks className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">From the test {title}</span>
          </>
        ) : (
          <>
            <Compass className="size-3.5 shrink-0" aria-hidden="true" />
            <span>
              {from} · {bug.feature}
            </span>
            {linked && (
              <>
                <span aria-hidden="true">·</span>
                <ByTest appId={appId} test={linked}>
                  Tested by
                </ByTest>
              </>
            )}
          </>
        )
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {confirmed ? (
            <Chip icon={BadgeCheck} tone="text-live">
              {bug.reproduced ? "Reproduced in a fresh browser" : "Confirmed"}
            </Chip>
          ) : (
            <Chip icon={CircleDashed}>{BUG_STATUS_LABEL[bug.status]}</Chip>
          )}
          {bug.seen > 1 && <Chip icon={Repeat2}>Seen {bug.seen} times</Chip>}
          {linked && <Chip icon={CircleCheck}>Closes when its test passes</Chip>}
        </div>
        <BugActions passId={passId} bugId={bug.id} triage={triage} />
      </div>
      <p className="max-w-prose text-pretty">{bug.summary}</p>
      <Evidence {...entry} appUrl={appUrl} />
    </BugLine>
  );
}

function TestLink({ test, children }: { test: BugTest; children: ReactNode }) {
  return (
    <Link href={`/apps/${test.appId}/tests/${test.id}`} className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </Link>
  );
}

/** One kind of bug that is out of the list, folded away under its count. */
function Aside({ summary, bugs, row }: { summary: ReactNode; bugs: AppBug[]; row: (b: AppBug) => ReactNode }) {
  if (bugs.length === 0) return null;
  return (
    <details>
      <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">{summary}</summary>
      <ul className="flex flex-col gap-3 pt-3 pb-1">
        {bugs.map((b) => (
          <li key={b.bug.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {row(b)}
          </li>
        ))}
      </ul>
    </details>
  );
}

/** What is out of the list: bugs whose test passed, bugs somebody dismissed, and reports that didn't hold up. */
export function SetAside({ bugs }: { bugs: AppBug[] }) {
  if (bugs.length === 0) return null;
  const name = "min-w-0 flex-1 basis-80 text-pretty";
  return (
    <div className="flex flex-col gap-3 px-1 text-sm">
      <Aside
        bugs={bugs.filter((b) => b.triage === "fixed")}
        summary={
          <>
            <CircleCheck className="size-3.5 text-good" aria-hidden="true" />
            {bugs.filter((b) => b.triage === "fixed").length} fixed
          </>
        }
        row={({ bug, test }) => (
          <>
            <p className={name}>
              {bug.name}
              <span className="text-muted-foreground"> · Its test passed</span>
            </p>
            {test && <TestLink test={test}>See the test</TestLink>}
          </>
        )}
      />
      <Aside
        bugs={bugs.filter((b) => b.triage === "dismissed")}
        summary={`${bugs.filter((b) => b.triage === "dismissed").length} dismissed`}
        row={({ bug, passId }) => (
          <>
            <p className={name}>{bug.name}</p>
            <BugActions passId={passId} bugId={bug.id} triage="dismissed" />
          </>
        )}
      />
      <Aside
        bugs={bugs.filter((b) => b.triage === "open")}
        summary={`${plural(bugs.filter((b) => b.triage === "open").length, "report")} didn't hold up`}
        row={({ bug }) => (
          <p className={name}>
            {bug.name}
            <span className="text-muted-foreground">
              {" · "}
              {BUG_STATUS_LABEL[bug.status]}
              {bug.reasoning && ` · ${bug.reasoning}`}
            </span>
          </p>
        )}
      />
    </div>
  );
}
