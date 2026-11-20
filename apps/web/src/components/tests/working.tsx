import type { MakeGoal } from "@dappdrill/core";
import type { makes, RepairState } from "@dappdrill/db";
import Link from "next/link";
import type { ReactNode } from "react";
import { stopMakeAction } from "@/actions/tests";
import { Elapsed } from "@/components/elapsed";
import { BrowserWindow, SiteLoading } from "@/components/site-preview";
import { SubmitButton } from "@/components/submit-button";
import { cx } from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";
import { artifactUrl } from "@/lib/artifacts";
import { hostFromUrl, plural } from "@/lib/format";
import { Latest, LiveFrame, Pulse } from "./live";
import { SaidNote, saidShort } from "./said";
import { Stages, type Stage } from "./stages";
import { LiveDot } from "./status";

type MakeRow = typeof makes.$inferSelect;
/** A row of `makes` that is a repair. */
export type RepairRow = MakeRow & { state: { repair: RepairState } };

/** How many of a queue are listed before the rest are only counted. */
const LISTED = 6;

/** When a picture of our browser was taken: the engine names each by its time, and takes one only while the page is changing. */
const takenAt = (frame?: string) => Number(/-(\d{13})\.jpg$/.exec(frame ?? "")?.[1]) || undefined;

/**
 * Something being worked on, as it happens: what our browser sees on the left, and on the right what is going
 * on, for how long, and the button that stops it. Exploring, generating and repairing all have this shape.
 */
function Working({ label, appUrl, row, frame, doing, status, headline, stages, children }: { label: string; appUrl: string; row: MakeRow; frame?: string; doing: string; status: string; headline: string; stages?: Stage[]; children: ReactNode }) {
  const src = artifactUrl("makes", row.id, frame);
  const taken = row.status === "running" ? takenAt(frame) : undefined;
  return (
    <section aria-label={label} className="flex flex-col gap-8">
      {stages && <Stages stages={stages} />}
      <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-10">
        <figure className="flex flex-col gap-3 self-start">
          <BrowserWindow url={appUrl} toolbar={taken && <Pulse at={taken} now={Date.now()} />}>
            <div className="relative aspect-[16/10] overflow-hidden bg-card">
              {src ? <LiveFrame src={src} /> : <SiteLoading />}
              <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border bg-background/85 px-3 py-2 text-sm shadow-md backdrop-blur-md">
                {!src && <Spinner className="size-3.5 shrink-0 text-muted-foreground" />}
                <span className="truncate">{doing}</span>
              </div>
            </div>
          </BrowserWindow>
          <figcaption className="px-1 text-xs text-pretty text-muted-foreground">Our browser, as it goes. It stands still while we read the page and write the steps down.</figcaption>
        </figure>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex min-h-8 items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="flex flex-wrap items-center gap-x-2">
              <LiveDot />
              {status}
              {row.startedAt && (
                <>
                  {" · "}
                  <Elapsed since={row.startedAt.toISOString()} />
                </>
              )}
            </span>
            <form action={stopMakeAction.bind(null, row.id)}>
              <SubmitButton variant="outline" size="sm" busy="Stopping…" disabled={row.stopRequested}>
                {row.stopRequested ? "Stopping…" : "Stop"}
              </SubmitButton>
            </form>
          </div>
          <h2 className="text-xl font-semibold tracking-tight text-balance">{headline}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

/** What is in hand right now, set off by a rule in the live colour. */
function Now({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-live pl-3.5 text-sm">
      <p className="text-xs font-medium text-live">{label}</p>
      {children}
    </div>
  );
}

/** What comes after: a few by name, the rest counted. */
function Queue({ title, items }: { title: string; items: { key: string; text: ReactNode; word?: ReactNode }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ol className="flex flex-col gap-1.5">
        {items.slice(0, LISTED).map((item) => (
          <li key={item.key} className="flex items-baseline justify-between gap-4">
            <span className="min-w-0 truncate text-muted-foreground">{item.text}</span>
            {item.word && <span className="shrink-0 text-xs text-muted-foreground">{item.word}</span>}
          </li>
        ))}
      </ol>
      {items.length > LISTED && <p className="text-xs text-muted-foreground">and {items.length - LISTED} more</p>}
    </div>
  );
}

const found = (g: MakeGoal) => g.status === "kept" && g.stands === "failed";

const BAR: Record<MakeGoal["status"], string> = {
  waiting: "bg-foreground/10",
  making: "bg-live animate-pulse motion-reduce:animate-none",
  kept: "bg-good-bar",
  "not-kept": "bg-warn-bar",
};

/** One bar for each goal, in order, and what they came to so far in words. */
function Progress({ goals }: { goals: MakeGoal[] }) {
  const count = (is: (g: MakeGoal) => boolean) => goals.filter(is).length;
  const ready = count((g) => g.status === "kept" && !found(g));
  const bugs = count(found);
  const none = count((g) => g.status === "not-kept");
  const left = count((g) => g.status === "waiting" || g.status === "making");
  return (
    <div className="flex flex-col gap-2">
      <div role="img" aria-label={`${goals.length - left} of ${goals.length} done`} className="flex gap-1">
        {goals.map((g, i) => (
          <span key={i} className={cx("h-1.5 flex-1 rounded-full", found(g) ? "bg-bad-mid" : BAR[g.status])} />
        ))}
      </div>
      <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
        {ready > 0 && <span className="text-good">{plural(ready, "test")} ready</span>}
        {bugs > 0 && <span className="text-bad">{plural(bugs, "bug")} found</span>}
        {none > 0 && <span className="text-warn">{none} need you</span>}
        {left > 0 && <span>{left} to go</span>}
      </p>
    </div>
  );
}

/** The three steps of making an app's tests, with where this make is. */
function makeStages(make: MakeRow): Stage[] {
  const { stage, goals } = make.state;
  const exploring = make.status === "queued" || stage === "looking";
  const done = goals.filter((g) => g.status === "kept" || g.status === "not-kept").length;
  return [
    { title: "Explore your app", state: exploring ? "now" : "done", detail: exploring ? "Finding what users come here to do. Nothing is signed." : `Found ${plural(goals.length, "thing")} users do here.` },
    { title: "Generate tests", state: exploring ? "next" : "now", detail: exploring ? "One for each thing a user can do." : `${done} of ${goals.length} done. Each is kept once it goes the same way twice.` },
    { title: "Review", state: "next", detail: "The bugs we found, and anything we need from you." },
  ];
}

/**
 * Tests being generated, as it happens. For a whole app it starts with exploring and shows the three steps;
 * for one test added by hand it is that test alone. `next` are the tests added meanwhile, which wait their turn.
 * `email` is who hears when an app's first tests are ready.
 */
export function MakeWork({ appUrl, make, next = [], first, email }: { appUrl: string; make: MakeRow; next?: MakeRow[]; first?: boolean; email?: string }) {
  const { state } = make;
  const queued = make.status === "queued";
  const exploring = state.stage === "looking";
  const current = state.goals.find((g) => g.status === "making");
  const frame = current ? current.frame : state.frame;
  const said = current?.said ?? (current ? undefined : state.said);
  // A goal's own steps while it is generated, the look's while exploring. The note showing in full above them isn't said twice.
  const log = (current ? current.log : exploring ? state.log : undefined) ?? [];
  const latest = log.at(-1)?.text ?? said;
  const done = state.goals.filter((g) => g.status === "kept" || g.status === "not-kept").length;
  const headline = queued ? "Waiting for a browser" : make.goal ? "Generating your test" : exploring ? `Exploring ${hostFromUrl(appUrl)}` : current ? `${done} of ${plural(state.goals.length, "test")} done` : "Finishing up";
  const ahead = [
    ...state.goals.filter((g) => g !== current && (g.status === "making" || g.status === "waiting")).map((g, i) => ({ key: `g${i}`, text: g.goal, word: g.status === "making" ? <span className="text-live">Generating</span> : undefined })),
    ...next.flatMap((m) => (m.goal ? [{ key: m.id, text: m.goal, word: undefined }] : [])),
  ];

  return (
    <Working
      label="Generating tests"
      appUrl={appUrl}
      row={make}
      frame={frame}
      doing={queued ? "Waiting for a browser…" : latest ? saidShort(latest) : `${headline}…`}
      status={queued ? "Queued" : exploring ? "Exploring" : "Generating tests"}
      headline={headline}
      stages={make.goal ? undefined : makeStages(make)}
    >
      {state.goals.length > 1 && <Progress goals={state.goals} />}
      {current ? (
        <Now label="Now">
          <p className="font-medium text-pretty">{current.goal}</p>
          {current.suspicion && <p className="text-xs text-pretty text-muted-foreground">Looked wrong: {current.suspicion}</p>}
          {current.said && <SaidNote text={current.said} />}
        </Now>
      ) : (
        (state.summary || exploring) && <p className="text-sm text-pretty text-muted-foreground">{state.summary ?? "We open the app the way a user would and list what they come here to do. Each one becomes a test."}</p>
      )}
      <Latest log={current?.said ? log.filter((d) => d.text !== current.said) : log} now={Date.now()} />
      <Queue title="Up next" items={ahead} />
      {first && (
        <p className="mt-auto border-t pt-4 text-sm text-pretty text-muted-foreground">
          Takes up to an hour, and you can close this page.{" "}
          {email ? (
            <>
              We&apos;ll email <span className="font-medium text-foreground">{email}</span> when the tests are ready.
            </>
          ) : (
            "Each test shows below as soon as it is ready."
          )}
        </p>
      )}
    </Working>
  );
}

type RepairLine = RepairState["tests"][number];
const REPAIR_WORD: Record<RepairLine["status"], ReactNode> = {
  waiting: undefined,
  repairing: <span className="text-live">Repairing</span>,
  repaired: <span className="text-good">Repaired</span>,
  "not-repaired": <span className="text-warn">Not repaired</span>,
};

/** Tests being repaired, as it happens: the same shape as generating, with each test and what came of it. */
export function RepairWork({ appId, appUrl, repair: row }: { appId: string; appUrl: string; repair: RepairRow }) {
  const { state } = row;
  const { tests } = state.repair;
  const queued = row.status === "queued";
  const done = tests.filter((t) => t.status === "repaired" || t.status === "not-repaired").length;
  const current = tests.find((t) => t.status === "repairing");
  // The setup and the reset come before any test, and nothing names them while they are done.
  const headline = queued ? "Waiting for a browser" : current || done > 0 ? `${done} of ${plural(tests.length, "test")} repaired` : "Repairing the setup";
  const log = state.log ?? [];
  const latest = log.at(-1)?.text ?? state.said;

  return (
    <Working label="Repairing tests" appUrl={appUrl} row={row} frame={state.frame} doing={queued ? "Waiting for a browser…" : latest ? saidShort(latest) : `${headline}…`} status={queued ? "Queued" : "Repairing tests"} headline={headline}>
      <p className="text-sm text-pretty text-muted-foreground">
        {state.repair.afterBatch ? "The app changed under a run, so the steps that no longer fit are being recorded again." : "We do each step that can't run in the browser and record it again."} The repaired tests are run once afterwards.
      </p>
      {current && (
        <Now label="Now">
          <Link href={`/apps/${appId}/tests/${current.testId}`} className="font-medium text-pretty hover:underline">
            {current.name}
          </Link>
        </Now>
      )}
      <Latest log={log} now={Date.now()} />
      <Queue title="Tests" items={tests.filter((t) => t !== current).map((t) => ({ key: t.testId, text: t.name, word: REPAIR_WORD[t.status] }))} />
    </Working>
  );
}
