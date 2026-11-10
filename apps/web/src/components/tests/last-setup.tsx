import type { TestRunRow } from "@dappdrill/db";
import { artifactUrl } from "@/lib/artifacts";
import { timeAgo } from "@/lib/format";

/**
 * The setup as it last ran (the run that did it, not one that started from its state). Steps edited since show
 * without results. `resetTexts` are the setup's reset steps; their results come along when the run has them.
 */
export function lastSetup(texts: string[], runs: TestRunRow[], resetTexts: string[] = []) {
  const run = runs.filter((r) => r.result?.setup && !r.result.setup.reused).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const setup = run?.result?.setup;
  if (!run || !setup || setup.steps.length !== texts.length) return undefined;
  const unfinished = (s: { status: string }) => s.status === "running" || s.status === "pending";
  const running = setup.steps.some(unfinished) || (setup.reset?.some(unfinished) ?? false);
  const label = running ? (
    <span className="text-live">running now</span>
  ) : setup.ok ? (
    `passed ${run.finishedAt ? timeAgo(run.finishedAt) : ""}`.trim()
  ) : (
    <span className="text-warn">didn&apos;t finish {run.finishedAt ? timeAgo(run.finishedAt) : ""}</span>
  );
  const shot = (path?: string) => artifactUrl("runs", run.batchId, path);
  return {
    label,
    ok: setup.ok && !running,
    failed: !setup.ok && !running,
    steps: texts.map((text, i) => ({ text, result: setup.steps[i], shot: shot(setup.steps[i]?.screenshot) })),
    // Reset steps edited since the run no longer line up with its results, so they show without any.
    reset: resetTexts.length > 0 ? resetTexts.map((text, i) => (setup.reset?.length === resetTexts.length ? { text, result: setup.reset[i], shot: shot(setup.reset[i]?.screenshot) } : { text })) : undefined,
  };
}
