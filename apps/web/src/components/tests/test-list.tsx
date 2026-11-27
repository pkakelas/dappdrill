"use client";

import { ListChevronsDownUp, ListChevronsUpDown, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { plural } from "@/lib/format";
import { LiveDot } from "./status";
import { DeleteTests, RunAgainst, SelectionBar, type Picked } from "./test-bulk";
import { GroupHead, MoveTests, NO_GROUP, RenameGroup, useFolded } from "./test-groups";
import type { MakingItem, Stands, TestItem } from "./test-item";
import { MakingRow } from "./test-making";
import { TestRow } from "./test-row";

type Kind = Stands | "running";

/** The ways a test stands, what needs a look first: its dot, its colour, and how a count of them reads. */
const KINDS: { kind: Kind; dot?: string; tone?: string; words: (n: number) => string }[] = [
  { kind: "bug", dot: "bg-bad-mid", tone: "text-bad", words: (n) => `${plural(n, "bug")} found` },
  { kind: "failed", dot: "bg-bad-mid", tone: "text-bad", words: (n) => `${n} failed` },
  { kind: "repair", dot: "bg-warn-bar", tone: "text-warn", words: (n) => `${n} ${n === 1 ? "needs" : "need"} repair` },
  { kind: "unverified", dot: "bg-warn-bar", tone: "text-warn", words: (n) => `${n} couldn't verify` },
  { kind: "passed", dot: "bg-good-bar", words: (n) => `${n} passed` },
  { kind: "never", dot: "bg-foreground/20", tone: "text-muted-foreground", words: (n) => `${n} not run yet` },
  { kind: "running", tone: "text-live", words: (n) => `${n} running` },
];

/** From this many tests on, the list can be searched. */
const SEARCH_FROM = 8;

const is = (item: TestItem, kind: Kind) => (kind === "running" ? Boolean(item.now) : item.stands === kind);

/** The ways a test stands that someone should look at. */
const LOOK: Kind[] = ["bug", "failed", "repair", "unverified"];

/**
 * The app's tests: how they stand as filters to press, then one card with the line that adds a test, the tests
 * being generated, and each test on a line that opens in place. Once a test names a group, the tests are listed
 * under their groups' headings, which open and close. Picking tests brings up what can be done to several at once.
 */
export function TestList({ appId, appUrl, items, making = [], now, lastRun, fresh, add }: { appId: string; appUrl: string; items: TestItem[]; making?: MakingItem[]; now: number; lastRun?: string; fresh: number; add: ReactNode }) {
  const [filter, setFilter] = useState<Kind>();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [deleting, setDeleting] = useState<Picked[]>();
  const [against, setAgainst] = useState<Picked>();
  const [moving, setMoving] = useState<Picked[]>();
  const [renaming, setRenaming] = useState<string>();
  const [folded, setFolded] = useFolded(appId);

  const kinds = KINDS.map((k) => ({ ...k, count: items.filter((t) => is(t, k.kind)).length })).filter((k) => k.count > 0);
  // A filter whose last test went another way (it ran and passed) gives way to all of them.
  const at = kinds.some((k) => k.kind === filter) ? filter : undefined;
  const words = query.trim().toLowerCase();
  const shown = items.filter((t) => (!at || is(t, at)) && (!words || t.name.toLowerCase().includes(words) || t.goal.toLowerCase().includes(words)));
  const picked = shown.filter((t) => selected.has(t.id));
  // The tests being generated come first, where each will be once it is ready. They aren't tests yet, so a narrowed list leaves them out.
  const coming = at || words ? [] : making;

  // The groups the tests name, and the tests shown under each: a group with something to look at first, the tests that name none last.
  const groups = [...new Set(items.flatMap((t) => (t.group ? [t.group] : [])))].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, count: items.filter((t) => t.group === name).length }));
  const look = (tests: TestItem[]) => tests.some((t) => LOOK.some((k) => is(t, k)));
  const sections = [...groups.map((g): string | undefined => g.name), undefined]
    .map((name) => ({ name, tests: shown.filter((t) => t.group === name) }))
    .filter((s) => s.tests.length > 0)
    .sort((a, b) => Number(!a.name) - Number(!b.name) || Number(look(b.tests)) - Number(look(a.tests)));
  // A narrowed list shows what it found, in whichever group it is.
  const narrowed = Boolean(at || words);
  const closed = (name?: string) => !narrowed && folded.has(name ?? "");
  const allClosed = sections.every((s) => folded.has(s.name ?? ""));

  const toggle = (set: ReadonlySet<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  // What is picked is what is in sight: narrowing the list drops the rest.
  const narrow = (to: { filter?: Kind; query?: string }) => {
    if ("filter" in to) setFilter(to.filter);
    if (to.query !== undefined) setQuery(to.query);
    setSelected(new Set());
  };

  const row = (item: TestItem) => (
    <TestRow
      key={item.id}
      appId={appId}
      appUrl={appUrl}
      item={item}
      open={opened.has(item.id)}
      onOpen={() => setOpened(toggle(opened, item.id, !opened.has(item.id)))}
      selected={selected.has(item.id)}
      onSelect={(on) => setSelected(toggle(selected, item.id, on))}
      onDelete={() => setDeleting([item])}
      onRunAgainst={() => setAgainst(item)}
      onMove={() => setMoving([item])}
    />
  );

  return (
    <section aria-labelledby="tests" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2 id="tests" className="text-base font-semibold tracking-tight">
          Tests
        </h2>
        {fresh > 0 && <span className="text-sm text-muted-foreground">{fresh} ready just now</span>}
        {lastRun && (
          <Link href={`/apps/${appId}/runs`} className="ml-auto text-sm text-muted-foreground hover:text-foreground hover:underline hover:underline-offset-4">
            Last run {lastRun}
          </Link>
        )}
      </div>

      {items.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {kinds.length === 1 ? (
            <p aria-label="How the tests stand" className={cx("inline-flex h-8 items-center gap-2 text-sm font-medium", kinds[0]!.tone)}>
              <Dot kind={kinds[0]!} />
              {kinds[0]!.kind === "passed" ? `All ${plural(items.length, "test")} passed` : kinds[0]!.words(items.length)}
            </p>
          ) : (
            <div role="group" aria-label="Show the tests that stand one way" className="-m-1 flex max-w-[calc(100%+0.5rem)] items-center gap-1.5 overflow-x-auto p-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
              <Chip on={!at} onClick={() => narrow({ filter: undefined })}>
                All
                <span className="font-normal text-muted-foreground tabular-nums">{items.length}</span>
              </Chip>
              {kinds.map((k) => (
                <Chip key={k.kind} on={at === k.kind} tone={k.tone} onClick={() => narrow({ filter: at === k.kind ? undefined : k.kind })}>
                  <Dot kind={k} />
                  {k.words(k.count)}
                </Chip>
              ))}
            </div>
          )}
          {(items.length >= SEARCH_FROM || groups.length > 0) && (
            <div className="flex w-full items-center gap-1.5 sm:w-auto">
              {items.length >= SEARCH_FROM && (
                <div className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
                  <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input type="search" aria-label="Search the tests" placeholder="Search tests" value={query} onChange={(e) => narrow({ query: e.target.value })} className="h-8 bg-card pl-8" />
                </div>
              )}
              {groups.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={narrowed}
                  aria-label={allClosed ? "Open every group" : "Close every group"}
                  title={allClosed ? "Open every group" : "Close every group"}
                  onClick={() => setFolded(allClosed ? new Set() : new Set(sections.map((s) => s.name ?? "")))}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                >
                  {allClosed ? <ListChevronsUpDown aria-hidden="true" /> : <ListChevronsDownUp aria-hidden="true" />}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* One card: the line that adds a test, the tests being generated, then the tests, under their groups when they name any. */}
      <div className="divide-y overflow-clip rounded-xl border bg-card shadow-xs">
        <div className="p-1.5">{add}</div>
        {coming.length > 0 && (
          <ul className="divide-y">
            {coming.map((item) => (
              <MakingRow key={item.id} appUrl={appUrl} item={item} open={opened.has(item.id)} onOpen={() => setOpened(toggle(opened, item.id, !opened.has(item.id)))} now={now} />
            ))}
          </ul>
        )}
        {groups.length > 0
          ? sections.map((s) => (
              <section key={s.name ?? ""} aria-label={s.name ?? NO_GROUP} className="divide-y">
                <GroupHead
                  appId={appId}
                  name={s.name}
                  testIds={s.tests.map((t) => t.id)}
                  running={s.tests.filter((t) => t.now).length}
                  open={!closed(s.name)}
                  onToggle={() => setFolded(toggle(folded, s.name ?? "", !folded.has(s.name ?? "")))}
                  onSelect={() => setSelected(new Set([...selected, ...s.tests.map((t) => t.id)]))}
                  onRename={() => setRenaming(s.name)}
                >
                  {KINDS.flatMap((k) => {
                    const n = s.tests.filter((t) => is(t, k.kind)).length;
                    return n > 0
                      ? [
                          <span key={k.kind} className={cx("inline-flex items-center gap-1.5", k.tone ?? "text-muted-foreground")}>
                            <Dot kind={k} />
                            {k.kind === "passed" && n === s.tests.length ? "All passed" : k.words(n)}
                          </span>,
                        ]
                      : [];
                  })}
                </GroupHead>
                {!closed(s.name) && <ul className="divide-y">{s.tests.map(row)}</ul>}
              </section>
            ))
          : shown.length > 0 && <ul className="divide-y">{shown.map(row)}</ul>}
        {shown.length + coming.length === 0 && items.length > 0 && (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {words ? `No test matches “${query.trim()}”${at ? " among these" : ""}.` : "No test stands this way now."}{" "}
            <button type="button" onClick={() => narrow({ filter: undefined, query: "" })} className="font-medium text-foreground underline-offset-4 hover:underline">
              Show all tests
            </button>
          </p>
        )}
      </div>

      {picked.length > 0 && (
        <SelectionBar
          appId={appId}
          picked={picked}
          more={shown.length - picked.length}
          onAll={() => setSelected(new Set(shown.map((t) => t.id)))}
          onClear={() => setSelected(new Set())}
          onDelete={() => setDeleting(picked)}
          onMove={() => setMoving(picked)}
        />
      )}
      <MoveTests appId={appId} tests={moving} groups={groups} onClose={() => setMoving(undefined)} onDone={() => (setMoving(undefined), setSelected(new Set()))} />
      <RenameGroup appId={appId} group={renaming} groups={groups} onClose={() => setRenaming(undefined)} />
      <DeleteTests appId={appId} tests={deleting} onClose={() => setDeleting(undefined)} onDone={() => (setDeleting(undefined), setSelected(new Set()))} />
      <RunAgainst appId={appId} appUrl={appUrl} test={against} onClose={() => setAgainst(undefined)} />
    </section>
  );
}

function Dot({ kind }: { kind: { kind: Kind; dot?: string } }) {
  return kind.kind === "running" ? <LiveDot /> : <span aria-hidden="true" className={cx("size-2 rounded-full", kind.dot)} />;
}

/** One way the tests stand, pressed to show only those. */
function Chip({ on, tone, onClick, children }: { on: boolean; tone?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        "inline-flex h-8 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        on ? "border-foreground/25 bg-foreground/[0.06] shadow-xs" : "border-transparent hover:bg-foreground/[0.05]",
        tone,
      )}
    >
      {children}
    </button>
  );
}
