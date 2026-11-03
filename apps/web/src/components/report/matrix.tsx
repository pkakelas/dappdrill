import { edgeCaseInfo } from "@dappdrill/core";
import Link from "next/link";
import { Cell } from "@/components/ui";
import type { Matrix } from "@/lib/report";
import type { ViewCtx } from "./ctx";

export function MatrixTable({ matrix, ctx }: { matrix: Matrix; ctx: ViewCtx }) {
  if (matrix.rows.length === 0) return <p className="hint m-0">No runs yet.</p>;
  return (
    <div className="card overflow-x-auto">
      <table className="table min-w-[640px]">
        <thead>
          <tr>
            <th scope="col" className="min-w-[180px]">
              Flow
            </th>
            {matrix.edgeCases.map((e) => (
              <th key={e} scope="col" className="text-center whitespace-nowrap">
                {edgeCaseInfo(e).label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr key={row.flowId}>
              <th scope="row" className="border-b border-divide text-left text-[15px] font-medium text-ink">
                {ctx.readOnly ? (
                  row.name
                ) : (
                  <Link href={`/apps/${ctx.appId}/flows/${row.flowId}`} className="no-underline hover:underline">
                    {row.name}
                  </Link>
                )}
              </th>
              {matrix.edgeCases.map((e) => {
                const cell = row.cells[e];
                return (
                  <td key={e} className="text-center">
                    {cell ? (
                      <Link href={ctx.panelHref(`run.${cell.runId}`)} scroll={false} className="no-underline" aria-label={`${row.name}, ${edgeCaseInfo(e).label}`}>
                        <Cell kind={cell.kind} />
                      </Link>
                    ) : (
                      <Cell kind="skipped" />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
