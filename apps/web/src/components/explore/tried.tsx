import Link from "next/link";
import { StateMark } from "@/components/tests/status";
import { cx } from "@/components/ui";
import type { TriedKind, TriedLine } from "@/lib/explore";

const KINDS: { kind: TriedKind; label: string }[] = [
  { kind: "pass", label: "Worked" },
  { kind: "fail", label: "Didn't work" },
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

function Row({ line, tests, appId }: { line: TriedLine; tests: Map<string, string>; appId: string }) {
  const testId = line.became?.testName ? tests.get(line.became.testName) : undefined;
  return (
    <li className="flex items-start gap-3 px-3.5 py-2.5">
      <StateMark state={line.kind === "gap" ? "skipped" : line.kind} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm text-pretty">{line.name}</span>
          <span className="line-clamp-2 text-xs break-words text-muted-foreground">{line.kind === "gap" ? `Not covered: ${line.detail}` : line.detail}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:pt-0.5">
          {line.became &&
            (testId ? (
              <Link href={`/apps/${appId}/tests/${testId}`} className="rounded-sm text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
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
 * Everything the pass tried, as a log: most of it never becomes a test, and this is where it shows.
 * `tests` maps a saved test's name to its id.
 */
export function Tried({ appId, lines, kind, tests, running }: { appId: string; lines: TriedLine[]; kind?: TriedKind; tests: Map<string, string>; running: boolean }) {
  const count = (k: TriedKind) => lines.filter((l) => l.kind === k).length;
  const shown = kind ? lines.filter((l) => l.kind === kind) : lines;
  const href = (k?: TriedKind) => `/apps/${appId}?tab=tried${k ? `&kind=${k}` : ""}`;

  if (lines.length === 0)
    return <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{running ? "Nothing tried yet. Each thing the explorers check shows here as it happens." : "Nothing was tried."}</p>;

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <nav aria-label="Filter what was tried" className="flex flex-wrap items-center gap-0.5 p-1.5">
        <Chip href={href()} on={!kind} label="All" />
        {KINDS.filter((k) => count(k.kind) > 0).map((k) => (
          <Chip key={k.kind} href={href(k.kind)} on={kind === k.kind} label={k.label} n={count(k.kind)} />
        ))}
      </nav>
      <ul className="divide-y border-t">
        {shown.slice(0, MOST).map((l) => (
          <Row key={l.id} line={l} tests={tests} appId={appId} />
        ))}
      </ul>
      {shown.length > MOST && <p className="border-t px-3.5 py-2.5 text-xs text-muted-foreground">Showing the newest {MOST} of {shown.length}.</p>}
    </div>
  );
}
