import { repeatable, testCheckKey } from "@dappdrill/core";
import Link from "next/link";
import { KeepCheck, type KeepTarget } from "@/components/explore/keep-check";
import { StateMark } from "@/components/tests/status";
import { cx } from "@/components/ui";
import type { TriedKind, TriedLine } from "@/lib/explore";

const KINDS: { kind: TriedKind; label: string }[] = [
  { kind: "pass", label: "Passed" },
  { kind: "fail", label: "Failed" },
  { kind: "error", label: "Couldn't check" },
  { kind: "gap", label: "Not covered" },
];

/** As many lines as a page can show without getting slow; the newest are the ones that matter. */
const MOST = 300;

function Chip({ href, on, label, n, bad }: { href: string; on: boolean; label: string; n?: number; bad?: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={on ? "true" : undefined}
      className={cx("flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
      {n !== undefined && <span className={cx("font-normal tabular-nums", bad ? "text-bad" : "text-muted-foreground")}>{n}</span>}
    </Link>
  );
}

function Row({ line, tests, kept, passId, appId }: { line: TriedLine; tests: KeepTarget[]; kept: Map<string, KeepTarget>; passId: string; appId: string }) {
  const byName = new Map(tests.map((t) => [t.name, t.id]));
  const testId = line.became?.testName ? byName.get(line.became.testName) : undefined;
  const bugId = line.became?.bugId;
  const href = testId ? `/apps/${appId}/tests/${testId}` : bugId && `/apps/${appId}?tab=bugs&bug=${bugId}#${bugId}`;
  // A check that passed and copied nothing off the page can be kept on a test, where every run makes it again.
  const on = line.assert && kept.get(testCheckKey({ name: line.name, assert: line.assert }));
  const keepable = !on && line.kind === "pass" && line.assert && repeatable(line.assert);
  return (
    <li className="flex items-start gap-3 px-3.5 py-2.5">
      <StateMark state={line.kind === "gap" ? "skipped" : line.kind} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-pretty">{line.name}</span>
          <span className="line-clamp-2 text-xs break-words text-muted-foreground">{line.kind === "gap" ? `Not covered: ${line.detail}` : line.detail}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:pt-0.5">
          {on && (
            <Link href={`/apps/${appId}/tests/${on.id}`} className="rounded-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
              Checked on every run
            </Link>
          )}
          {on && <span aria-hidden="true">·</span>}
          {keepable && <KeepCheck passId={passId} checkId={line.id} tests={tests} suggested={line.became?.testName} />}
          {keepable && <span aria-hidden="true">·</span>}
          {line.became &&
            (href ? (
              <Link href={href} className={cx("rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring", line.became.tone === "bad" ? "text-bad" : "text-foreground")}>
                {line.became.text}
              </Link>
            ) : (
              <span className={line.became.tone === "bad" ? "text-bad" : "text-foreground"}>{line.became.text}</span>
            ))}
          {line.became && <span aria-hidden="true">·</span>}
          <span>{line.feature}</span>
        </span>
      </div>
    </li>
  );
}

/**
 * Every check the explorers made, as a log. A check runs once: one that passed may have been kept
 * as a test, one that failed may have turned into a bug, and one that can be made again may be kept
 * on a test's step. `tests` are the app's tests; `kept` says which test holds each kept check, by its key.
 */
export function Tried({ appId, passId, lines, kind, tests, kept, running }: { appId: string; passId: string; lines: TriedLine[]; kind?: TriedKind; tests: KeepTarget[]; kept: Map<string, KeepTarget>; running: boolean }) {
  const count = (k: TriedKind) => lines.filter((l) => l.kind === k).length;
  const shown = kind ? lines.filter((l) => l.kind === kind) : lines;
  const href = (k?: TriedKind) => `/apps/${appId}?tab=checks${k ? `&kind=${k}` : ""}`;

  if (lines.length === 0)
    return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{running ? "Checks show here as they happen." : "No checks were made."}</p>;

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <nav aria-label="Filter checks" className="flex flex-wrap items-center gap-0.5 p-1.5">
        <Chip href={href()} on={!kind} label="All" />
        {KINDS.filter((k) => count(k.kind) > 0).map((k) => (
          <Chip key={k.kind} href={href(k.kind)} on={kind === k.kind} label={k.label} n={count(k.kind)} />
        ))}
      </nav>
      <ul className="divide-y border-t">
        {shown.slice(0, MOST).map((l) => (
          <Row key={l.id} line={l} tests={tests} kept={kept} passId={passId} appId={appId} />
        ))}
      </ul>
      {shown.length > MOST && <p className="border-t px-3.5 py-2.5 text-xs text-muted-foreground">Showing the newest {MOST} of {shown.length}.</p>}
    </div>
  );
}
