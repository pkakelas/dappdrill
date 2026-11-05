import { OFFERED_CONDITIONS, SETTLED_LABEL, count, applicable } from "@dappdrill/core";
import type { TestRow, TestRunRow } from "@dappdrill/db";
import Link from "next/link";
import { readLabel, StateMark, type TestRead } from "@/components/tests/status";
import { cx } from "@/components/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Tests × conditions, from the same rows as the list: one row per test, one column per
 * condition we offer. A cell says not added, Not run yet, Passed, Failed,
 * Couldn't run or Doesn't apply (with why), so the gaps are as visible as the failures.
 */
export function ConditionGrid({ appId, tests, reads, settled }: { appId: string; tests: TestRow[]; reads: Map<string, TestRead>; settled: Map<string, TestRunRow> }) {
  const bases = tests.filter((t) => !t.baseId);
  const cell = (base: TestRow, conditionId: string) => tests.find((t) => t.baseId === base.id && t.condition === conditionId);
  const totals = OFFERED_CONDITIONS.map((c) => {
    const rows = bases.map((test) => cell(test, c.id)).filter((t): t is TestRow => Boolean(t));
    return { added: rows.length, ...count(applicable(rows.map((t) => reads.get(t.id)!))) };
  });

  if (bases.length === 0) return <p className="text-sm text-muted-foreground">No tests yet, so nothing to run conditions on.</p>;

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-xs">
      <Table className="min-w-max">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky left-0 z-10 bg-card pl-5">Test</TableHead>
            <TableHead>Result</TableHead>
            {OFFERED_CONDITIONS.map((c) => (
              <TableHead key={c.id} className="whitespace-nowrap" title={c.expected}>
                {c.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {bases.map((test) => (
            <TableRow key={test.id}>
              <TableCell className="sticky left-0 z-10 bg-card pl-5 font-medium">
                <Link href={`/apps/${appId}/tests/${test.id}`} className="hover:underline">
                  {test.name}
                </Link>
              </TableCell>
              <TableCell>
                <Cell appId={appId} test={test} read={reads.get(test.id)!} run={settled.get(test.id)} />
              </TableCell>
              {OFFERED_CONDITIONS.map((c) => {
                const row = cell(test, c.id);
                return <TableCell key={c.id}>{row ? <Cell appId={appId} test={row} read={reads.get(row.id)!} run={settled.get(row.id)} /> : <span className="text-xs text-muted-foreground/60">not added</span>}</TableCell>;
              })}
            </TableRow>
          ))}
          <TableRow className="hover:bg-transparent">
            <TableCell className="sticky left-0 z-10 bg-card pl-5 text-xs text-muted-foreground" colSpan={2}>
              Per condition
            </TableCell>
            {totals.map((t, i) => (
              <TableCell key={OFFERED_CONDITIONS[i]!.id} className="text-xs text-muted-foreground tabular-nums">
                {t.added === 0 ? "—" : <span className={cx(t.failed > 0 && "text-warn")}>{t.total === 0 ? `${t.added} added, none apply` : `${t.passed}/${t.total} passed${t.failed ? `, ${t.failed} failed` : ""}${t.couldntRun ? `, ${t.couldntRun} couldn't run` : ""}`}</span>}
              </TableCell>
            ))}
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

function Cell({ appId, test, read, run }: { appId: string; test: TestRow; read: TestRead; run?: TestRunRow }) {
  const why = read.settled === "skipped" || read.settled === "error" || read.settled === "fail" ? run?.result?.failure : undefined;
  const tone = read.settled === "fail" ? "text-bad" : read.settled === "error" ? "text-warn" : read.active ? "text-live" : "text-muted-foreground";
  return (
    <Link href={`/apps/${appId}/tests/${test.id}`} title={why ? `${SETTLED_LABEL[read.settled]}: ${why}` : undefined} className={cx("inline-flex items-center gap-1.5 whitespace-nowrap text-xs hover:underline", tone)}>
      <StateMark state={read.mark} className="size-3.5" />
      {readLabel(read)}
    </Link>
  );
}
