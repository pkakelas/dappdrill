import { edgeCaseInfo } from "@dappdrill/core";
import Link from "next/link";
import { CELL, Cell, type CellKind } from "@/components/common";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Matrix } from "@/lib/report";
import type { ViewCtx } from "./ctx";

export function MatrixTable({ matrix, ctx }: { matrix: Matrix; ctx: ViewCtx }) {
  if (matrix.rows.length === 0) return <p className="text-muted-foreground">No runs yet.</p>;
  const seen = new Set<CellKind>(matrix.rows.flatMap((r) => matrix.edgeCases.map((e) => r.cells[e]?.kind ?? "skipped")));
  const legend = LEGEND.filter((k) => seen.has(k));
  return (
    <div className="rounded-xl border bg-card shadow-xs">
      <Table className="min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[180px] pl-4">Flow</TableHead>
            {matrix.edgeCases.map((e) => (
              <TableHead key={e} className="text-center">
                {edgeCaseInfo(e).label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {matrix.rows.map((row) => (
            <TableRow key={row.flowId}>
              <TableHead scope="row" className="pl-4 font-medium text-foreground">
                {ctx.readOnly ? (
                  row.name
                ) : (
                  <Link href={`/apps/${ctx.appId}/flows/${row.flowId}`} className="hover:underline">
                    {row.name}
                  </Link>
                )}
              </TableHead>
              {matrix.edgeCases.map((e) => {
                const cell = row.cells[e];
                return (
                  <TableCell key={e} className="text-center">
                    {cell ? (
                      <Link href={ctx.panelHref(`run.${cell.runId}`)} scroll={false} aria-label={`${row.name}, ${edgeCaseInfo(e).label}: ${CELL[cell.kind].label}`}>
                        <Cell kind={cell.kind} />
                      </Link>
                    ) : (
                      <Cell kind="skipped" />
                    )}
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t px-4 py-3">
        {legend.map((k) => (
          <Cell key={k} kind={k} label small />
        ))}
      </div>
    </div>
  );
}

const LEGEND: CellKind[] = ["pass", "issue", "issue-high", "fail", "signing", "error", "running", "queued", "skipped"];
