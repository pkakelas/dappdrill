import { OFFERED_CONDITIONS, SETTLED_LABEL, count, applicable, type EdgeCaseId } from "@dappdrill/core";
import type { TestRow, TestRunRow } from "@dappdrill/db";
import { Ban, CircleHelp, Fuel, Gauge, Hourglass, Network, RotateCw, ShieldCheck, ShieldOff, Unplug, UserRoundCog, WalletCards, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { readLabel, StateMark, type TestRead } from "@/components/tests/status";
import { Tile, TINT } from "@/components/tests/tile";
import { cx } from "@/components/ui";
import { Card } from "@/components/ui/card";
import { plural } from "@/lib/format";

/** Each condition's tile on this page. */
const LOOK: Partial<Record<EdgeCaseId, { icon: LucideIcon; tint: keyof typeof TINT }>> = {
  reject: { icon: Ban, tint: "pink" },
  "slow-rpc": { icon: Hourglass, tint: "live" },
  "wrong-network": { icon: Network, tint: "fork" },
  "low-gas": { icon: Fuel, tint: "warn" },
  "switch-account": { icon: UserRoundCog, tint: "fork" },
  "failing-rpc": { icon: Unplug, tint: "live" },
  "reload-while-pending": { icon: RotateCw, tint: "good" },
  "two-wallets": { icon: WalletCards, tint: "pink" },
  "unknown-chain": { icon: CircleHelp, tint: "warn" },
  "speed-up": { icon: Gauge, tint: "good" },
  "existing-approval": { icon: ShieldCheck, tint: "live" },
  "revoked-approval": { icon: ShieldOff, tint: "pink" },
};
const look = (id: EdgeCaseId) => LOOK[id] ?? { icon: CircleHelp, tint: "quiet" as const };

/**
 * What each condition found: a tile per condition in use, with the tests it runs on and how they
 * went, worst first. The conditions nobody added stay in one line under them, so the gaps still show.
 */
export function ConditionGrid({ appId, tests, reads, settled }: { appId: string; tests: TestRow[]; reads: Map<string, TestRead>; settled: Map<string, TestRunRow> }) {
  const bases = tests.filter((t) => !t.baseId);
  if (bases.length === 0) return <p className="text-sm text-muted-foreground">No tests yet, so nothing to run conditions on.</p>;

  const all = OFFERED_CONDITIONS.map((condition) => {
    const added = bases.flatMap((base) => tests.filter((t) => t.baseId === base.id && t.condition === condition.id).map((test) => ({ base, test })));
    return { condition, added, counts: count(applicable(added.map(({ test }) => reads.get(test.id)!))) };
  });
  const rank = ({ counts: c }: (typeof all)[number]) => (c.failed > 0 ? 0 : c.couldntRun > 0 ? 1 : 2);
  const used = all.filter((c) => c.added.length > 0).sort((a, b) => rank(a) - rank(b));
  const unused = all.filter((c) => c.added.length === 0);

  return (
    <div className="flex flex-col gap-8">
      {used.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {used.map(({ condition, added, counts: c }) => {
            const missing = bases.length - added.length;
            return (
              <Card key={condition.id} className={cx("gap-3 p-5 shadow-sm", c.failed > 0 && "border-bad-line bg-bad-soft")}>
                <div className="flex gap-3">
                  <Tile {...look(condition.id)} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="text-sm leading-snug font-medium">{condition.name}</h3>
                      <span className={cx("shrink-0 text-xs tabular-nums", c.failed > 0 ? "text-bad" : c.couldntRun > 0 ? "text-warn" : "text-muted-foreground")}>{summary(added.length, c)}</span>
                    </div>
                    <p className="text-sm text-pretty text-muted-foreground">{condition.expected}</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-1">
                  {added.map(({ base, test }) => (
                    <li key={test.id}>
                      <Result appId={appId} name={base.name} test={test} read={reads.get(test.id)!} run={settled.get(test.id)} />
                    </li>
                  ))}
                </ul>
                {missing > 0 && <p className="mt-auto text-xs text-muted-foreground">Not added to {plural(missing, "other test")}</p>}
              </Card>
            );
          })}
        </div>
      )}
      {unused.length > 0 && (
        <section aria-label="Not added yet" className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-medium">Not added yet</h2>
            <p className="text-sm text-muted-foreground">Add these from a test&apos;s page.</p>
          </div>
          <ul className="flex flex-wrap gap-2">
            {unused.map(({ condition }) => {
              const { icon: Icon, tint } = look(condition.id);
              return (
                <li key={condition.id} title={condition.expected} className="flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1 text-sm shadow-xs">
                  <span className={cx("flex size-6 items-center justify-center rounded-full", TINT[tint])}>
                    <Icon className="size-3.5" aria-hidden="true" />
                  </span>
                  {condition.name}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function summary(added: number, c: ReturnType<typeof count>) {
  if (c.total === 0) return `${added} added, none apply`;
  return [`${c.passed} of ${c.total} passed`, c.failed > 0 && `${c.failed} failed`, c.couldntRun > 0 && `${c.couldntRun} couldn't run`].filter(Boolean).join(", ");
}

function Result({ appId, name, test, read, run }: { appId: string; name: string; test: TestRow; read: TestRead; run?: TestRunRow }) {
  const why = read.settled === "skipped" || read.settled === "error" || read.settled === "fail" ? run?.result?.failure : undefined;
  const tone = read.settled === "fail" ? "text-bad" : read.settled === "error" ? "text-warn" : read.active ? "text-live" : "text-muted-foreground";
  return (
    <Link href={`/apps/${appId}/tests/${test.id}`} title={why ? `${SETTLED_LABEL[read.settled]}: ${why}` : undefined} className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 text-sm outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring">
      <StateMark state={read.mark} />
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className={cx("shrink-0 text-xs", tone)}>{readLabel(read)}</span>
    </Link>
  );
}
