import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { MakeGoal, Tried } from "@dappdrill/core";
import { db, makes } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrowserWindow } from "@/components/site-preview";
import { RetryGoal } from "@/components/tests/goal-actions";
import { LINE_LABEL, LINE_STATE, StateMark } from "@/components/tests/status";
import { StatusNote, TestStatus } from "@/components/tests/test-status";
import { cx } from "@/components/ui";
import { artifactUrl } from "@/lib/artifacts";
import { env } from "@/lib/env";
import { plural, timeAgo } from "@/lib/format";
import { requireApp } from "@/lib/session";

type Params = { appId: string; makeId: string; n: string };

/** A goal a make left without a test, by the make and the goal's place in its list (from 1, like its folder). */
async function load({ appId, makeId, n }: Params) {
  const { app } = await requireApp(appId);
  const index = Number(n) - 1;
  const [make] = await db()
    .select()
    .from(makes)
    .where(and(eq(makes.id, makeId), eq(makes.appId, appId)));
  const goal = make?.state.goals[index];
  if (!make || !goal || goal.status !== "not-kept") notFound();
  // Makes on an app go one at a time, so a try made now waits for the one going.
  const [busy] = await db()
    .select({ id: makes.id })
    .from(makes)
    .where(and(eq(makes.appId, appId), inArray(makes.status, ["queued", "running"])))
    .limit(1);
  return { app, make, goal, index, busy: Boolean(busy) };
}

/** The newest recording of the goal: its last run, else its first try. Older makes kept no note of it, so it is read off the folder. */
async function recording(makeId: string, n: number): Promise<string | undefined> {
  const dir = path.join(env.artifactsDir, "makes", makeId, `make-${n}`);
  for (const sub of ["videos", "draft/videos"]) {
    const files = await readdir(path.join(dir, sub)).catch(() => []);
    const dated = await Promise.all(
      files
        .filter((f) => f.endsWith(".webm"))
        .map(async (f) => ({
          f,
          at: (await stat(path.join(dir, sub, f))).mtimeMs,
        })),
    );
    const newest = dated.sort((a, b) => b.at - a.at)[0];
    if (newest) return `make-${n}/${sub}/${newest.f}`;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  return { title: (await load(await params)).goal.goal };
}

/**
 * Something we couldn't write a test for, in the shape of a test's page: how it stands and why in one block,
 * with the field that answers it, then the steps as they last stood beside what our browser saw.
 */
export default async function GoalPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const { app, make, goal, index, busy } = await load(p);
  const n = index + 1;
  const video = artifactUrl("makes", make.id, await recording(make.id, n));
  const frame = artifactUrl("makes", make.id, goal.frame);
  const tried = goal.tried;
  const off = tried?.lines.find((l) => l.runs.at(-1) !== "pass" && l.runs.at(-1) !== "skipped");
  const making = make.status === "queued" || make.status === "running";
  const steps = tried && tried.lines.length > 0 ? tried : undefined;

  return (
    <div className="page flex flex-col gap-8">
      <header className="flex flex-col gap-5">
        <Link href={`/apps/${app.id}`} className="-ml-1 inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />
          Tests
        </Link>
        <div className="flex flex-col gap-2">
          <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-pretty">{goal.goal}</h1>
          {goal.why && <p className="max-w-3xl text-pretty text-muted-foreground">{goal.why}</p>}
        </div>
      </header>

      <TestStatus
        word={{ label: "No test yet", mark: "never", tone: "text-foreground" }}
        meta={
          <>
            tried {timeAgo(make.finishedAt ?? make.createdAt)}
            {tried && tried.runs > 0 && ` · run ${plural(tried.runs, "time")}`}
          </>
        }
      >
        <StatusNote title="Why there's no test">
          <p>{goal.whyNot ?? "It didn't go the same way twice, so no test was kept."}</p>
          {off && (
            <p className="text-muted-foreground">
              It went differently at “{off.text}”{off.note ? `: ${off.note}` : "."}
            </p>
          )}
        </StatusNote>

        {goal.suspicion && (
          <StatusNote title="What looked wrong in the app">
            <p>{goal.suspicion}</p>
          </StatusNote>
        )}

        {/* The engine's own question about this goal. Goals tried before it asked one get a plain prompt instead. */}
        <StatusNote title={tried?.ask ?? "Anything we should know?"}>
          {!tried?.ask && <p className="text-muted-foreground">Whatever it takes to do this in your app: a step first, the amount to use, how long it takes to show.</p>}
          {goal.dismissed || making ? (
            <p className="text-muted-foreground">{goal.dismissed ? "This was dismissed or answered already." : "You can answer once the tests are generated."}</p>
          ) : (
            <div className="pt-1.5">
              <RetryGoal appId={app.id} goal={goal.goal} retries={{ makeId: make.id, index }} placeholder={placeholder(goal)} waits={busy} />
            </div>
          )}
        </StatusNote>
      </TestStatus>

      <div className={cx("grid items-start gap-10", steps && "lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]")}>
        {steps && <WhatWeTried tried={steps} />}
        <figure className={cx("flex min-w-0 flex-col gap-3", steps ? "order-first lg:sticky lg:top-20 lg:order-none" : "max-w-2xl")}>
          <BrowserWindow url={app.url}>
            {video ? (
              <video src={video} poster={frame ?? undefined} controls muted playsInline className="block aspect-[16/10] w-full bg-black object-contain" />
            ) : frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame} alt="Where the browser stopped" className="block aspect-[16/10] w-full bg-muted object-cover object-top" />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-muted text-sm text-muted-foreground">No recording was kept.</div>
            )}
          </BrowserWindow>
          {(video || frame) && <figcaption className="px-1 text-sm text-muted-foreground">{video ? "The last time we tried it." : "Where the browser stopped."}</figcaption>}
        </figure>
      </div>
    </div>
  );
}

const placeholder = (goal: MakeGoal) => (goal.tried?.ask ? "Your answer, in a sentence" : "e.g. Withdrawals take a minute to show. Use 1 USDC.");

const DOT = {
  pass: "bg-good-bar",
  fail: "bg-bad-mid",
  unsure: "bg-warn-bar",
  skipped: "bg-foreground/15",
} as const;

/** The test as it last stood, a step each on one thread, with how each went in the runs of that wording. */
function WhatWeTried({ tried }: { tried: Tried }) {
  const runs = Math.max(0, ...tried.lines.map((l) => l.runs.length));
  return (
    <section aria-label="What we tried" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3 px-2">
        <h2 className="text-sm font-medium">What we tried</h2>
        {runs > 1 && <span className="text-xs text-muted-foreground">A dot for each of the last {runs} runs, oldest first</span>}
      </div>
      <ol className="flex flex-col">
        {tried.lines.map((line, i) => {
          const last = line.runs.at(-1) ?? "skipped";
          return (
            <li key={i} className="relative flex items-start gap-3 px-2 py-2.5">
              {i < tried.lines.length - 1 && <span aria-hidden="true" className="absolute top-[34px] -bottom-2 left-[17.5px] w-px bg-border" />}
              <StateMark state={LINE_STATE[last]} label={LINE_LABEL[last]} className="relative z-10 mt-px" />
              <span className="w-11 shrink-0 pt-[3px] text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{line.type === "action" ? "Do" : "Check"}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={cx("text-pretty", last === "skipped" && "text-muted-foreground")}>{line.text}</span>
                {line.note && <span className={cx("text-sm text-pretty [overflow-wrap:anywhere]", last === "fail" ? "text-bad" : last === "unsure" ? "text-warn" : "text-muted-foreground")}>{line.note}</span>}
              </div>
              {line.runs.length > 1 && (
                <span role="img" aria-label={line.runs.map((r) => LINE_LABEL[r]).join(", ")} className="flex shrink-0 gap-1 pt-1.5">
                  {line.runs.map((r, j) => (
                    <span key={j} className={cx("size-2 rounded-full", DOT[r])} />
                  ))}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
