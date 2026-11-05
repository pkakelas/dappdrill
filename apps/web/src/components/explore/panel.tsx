import Link from "next/link";
import { startExplorationAction } from "@/actions/explore";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ExploreLive } from "./live";
import { countsOf, liveView, type Exploration } from "@/lib/explore";
import { plural, timeAgo } from "@/lib/format";

function Summary({ appId, row }: { appId: string; row: Exploration }) {
  const report = (
    <Link href={`/apps/${appId}/explore`} className="text-foreground underline underline-offset-4">
      See the report
    </Link>
  );
  if (row.status === "failed") return <p className="text-sm text-muted-foreground">The last exploration didn&apos;t finish: {row.error ?? "something went wrong"}. {report}</p>;
  if (row.status === "stopped") return <p className="text-sm text-muted-foreground">The last exploration was stopped {timeAgo(row.finishedAt)}. {report}</p>;
  if (!row.state) return null;
  const c = countsOf(row.state);
  const parts = [plural(c.tests, "test") + " saved", c.drafts > 0 && plural(c.drafts, "draft"), plural(c.confirmed, "confirmed bug"), c.gaps > 0 && plural(c.gaps, "gap")].filter(Boolean);
  return (
    <p className="text-sm text-muted-foreground">
      Last explored {timeAgo(row.finishedAt)}: {parts.join(", ")}. {report}
    </p>
  );
}

/** Exploring in depth: the way in, the live view while it runs, and where the last one ended up. */
export function ExplorePanel({ appId, url, exploration }: { appId: string; url: string; exploration: Exploration | undefined }) {
  if (exploration && (exploration.status === "queued" || exploration.status === "running")) return <ExploreLive view={liveView(exploration, url)} />;
  return (
    <section aria-label="Explore in depth" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg bg-muted/50 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-80 flex-col gap-0.5">
        <h2 className="text-sm font-medium">Explore in depth</h2>
        {exploration ? <Summary appId={appId} row={exploration} /> : <p className="text-sm text-muted-foreground">Goes through every flow in its own browser, tries variations and files bugs. New tests must pass on a fresh fork first. Costs far more than a test run.</p>}
      </div>
      <form action={startExplorationAction.bind(null, appId)} className="flex items-center gap-2">
        <NativeSelect name="minutes" size="sm" defaultValue="30" aria-label="How long to explore" className="w-32">
          <NativeSelectOption value="15">15 minutes</NativeSelectOption>
          <NativeSelectOption value="30">30 minutes</NativeSelectOption>
          <NativeSelectOption value="60">1 hour</NativeSelectOption>
        </NativeSelect>
        <Button type="submit" size="sm" variant="outline">
          Explore
        </Button>
      </form>
    </section>
  );
}
