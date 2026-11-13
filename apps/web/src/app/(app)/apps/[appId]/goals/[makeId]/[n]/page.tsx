import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { MakeGoal, Tried } from "@dappdrill/core";
import { db, makes } from "@dappdrill/db";
import { and, eq, inArray } from "drizzle-orm";
import { CircleDashed, MessageCircleQuestion, ScanSearch, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrowserWindow } from "@/components/site-preview";
import { RetryGoal } from "@/components/tests/goal-actions";
import { LINE_LABEL, LINE_STATE, StateMark } from "@/components/tests/status";
import { SectionHead } from "@/components/tests/tile";
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
    const dated = await Promise.all(files.filter((f) => f.endsWith(".webm")).map(async (f) => ({ f, at: (await stat(path.join(dir, sub, f))).mtimeMs })));
    const newest = dated.sort((a, b) => b.at - a.at)[0];
    if (newest) return `make-${n}/${sub}/${newest.f}`;
  }
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  return { title: (await load(await params)).goal.goal };
}

export default async function GoalPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  const { app, make, goal, index, busy } = await load(p);
  const n = index + 1;
  const video = artifactUrl("makes", make.id, await recording(make.id, n));
  const frame = artifactUrl("makes", make.id, goal.frame);
  const tried = goal.tried;
  const off = tried?.lines.find((l) => l.runs.at(-1) !== "pass" && l.runs.at(-1) !== "skipped");

  return (
    <div className="page flex flex-col gap-10">
      <header className="flex flex-col gap-4">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <Link href={`/apps/${app.id}`} className="hover:text-foreground">
            Tests
          </Link>
        </nav>
        <div className="flex flex-col gap-2">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <CircleDashed className="size-4" aria-hidden="true" />
            <span>No test yet</span>
            <span>· tried {timeAgo(make.finishedAt ?? make.createdAt)}</span>
            {tried && tried.runs > 0 && <span>· run {plural(tried.runs, "time")}</span>}
          </p>
          <h1 className="max-w-3xl text-2xl font-semibold tracking-tight text-pretty">{goal.goal}</h1>
          {goal.why && <p className="max-w-3xl text-pretty text-muted-foreground">{goal.why}</p>}
        </div>
      </header>

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <figure className="flex flex-col gap-2">
          <BrowserWindow url={app.url}>
            {video ? (
              <video src={video} poster={frame ?? undefined} controls muted playsInline className="block aspect-[16/10] w-full bg-muted object-contain" />
            ) : frame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frame} alt="Where the browser stopped" className="block aspect-[16/10] w-full bg-muted object-cover object-top" />
            ) : (
              <div className="flex aspect-[16/10] items-center justify-center bg-muted text-sm text-muted-foreground">No recording was kept.</div>
            )}
          </BrowserWindow>
          {video && <figcaption className="text-xs text-muted-foreground">The last time it was tried.</figcaption>}
        </figure>

        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <SectionHead icon={TriangleAlert} tint="warn" title="Why there's no test" />
            <p className="text-pretty">{goal.whyNot ?? "It didn't go the same way twice, so no test was kept."}</p>
            {off && (
              <p className="text-sm text-pretty text-muted-foreground">
                It went differently at “{off.text}”{off.note ? `: ${off.note}` : "."}
              </p>
            )}
          </section>

          {goal.suspicion && (
            <section className="flex flex-col gap-3">
              <SectionHead icon={ScanSearch} tint="pink" title="What looked wrong" />
              <p className="text-pretty">{goal.suspicion}</p>
            </section>
          )}

          <section className="flex flex-col gap-4 border-t pt-8">
            {/* The engine's own question about this goal. Goals tried before it asked one get a plain prompt instead. */}
            <SectionHead
              icon={MessageCircleQuestion}
              tint="live"
              title={tried?.ask ? "What we need from you" : "Anything we should know?"}
              detail={tried?.ask ? undefined : "Whatever it takes to do this in your app: a step first, the amount to use, how long it takes to show."}
            />
            {tried?.ask && <p className="text-lg leading-snug font-medium text-pretty">{tried.ask}</p>}
            {goal.dismissed || make.status === "queued" || make.status === "running" ? (
              <p className="text-sm text-muted-foreground">{goal.dismissed ? "This goal was dismissed or tried again already." : "Answer once these tests are made."}</p>
            ) : (
              <RetryGoal appId={app.id} goal={goal.goal} retries={{ makeId: make.id, index }} placeholder={placeholder(goal)} waits={busy} />
            )}
          </section>
        </div>
      </div>

      {tried && tried.lines.length > 0 && <WhatWeTried tried={tried} />}
    </div>
  );
}

const placeholder = (goal: MakeGoal) => (goal.tried?.ask ? "Your answer, in a sentence" : "e.g. Withdrawals take a minute to show. Use 1 USDC.");

/** The test as it last stood, a line each, with how each line went in the runs of that wording. */
function WhatWeTried({ tried }: { tried: Tried }) {
  const runs = Math.max(0, ...tried.lines.map((l) => l.runs.length));
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">What we tried</h2>
        {runs > 0 && <p className="text-xs text-muted-foreground">The last {plural(runs, "run")}, oldest first</p>}
      </div>
      <ol className="flex flex-col divide-y divide-border/60 rounded-xl border">
        {tried.lines.map((line, i) => {
          const last = line.runs.at(-1) ?? "skipped";
          return (
            <li key={i} className="flex items-start gap-3 px-4 py-3 text-sm">
              <StateMark state={LINE_STATE[last]} label={LINE_LABEL[last]} className="mt-0.5" />
              <span className="w-11 shrink-0 pt-0.5 text-xs text-muted-foreground">{line.type === "action" ? "Do" : "Check"}</span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={cx("text-pretty", last === "skipped" && "text-muted-foreground")}>{line.text}</span>
                {line.note && <span className="text-xs text-pretty text-muted-foreground">{line.note}</span>}
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

const DOT = { pass: "bg-good-bar", fail: "bg-bad-mid", unsure: "bg-warn-bar", skipped: "bg-foreground/15" } as const;
