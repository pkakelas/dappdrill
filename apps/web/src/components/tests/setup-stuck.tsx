import type { SetupStuck } from "@dappdrill/core";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { makeTestsAction } from "@/actions/tests";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { plural } from "@/lib/format";
import { Tile } from "./tile";

/** One labelled part of the notice. */
function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1 text-pretty">{children}</dd>
    </div>
  );
}

/**
 * Making tests stopped because the setup didn't finish. Said once, in parts: what happened, the step it
 * stopped at when that helps, and what puts it right. No line numbers: they mean nothing to the reader.
 */
export function SetupStuckNotice({ appId, stuck, kept, left, chain, canMake }: { appId: string; stuck: SetupStuck; kept: number; left: number; chain?: string; canMake: boolean }) {
  const funds = stuck.fix === "funds";
  const where = chain ?? "the app's chain";
  const title = funds ? `Test funds aren't set up for ${where}` : stuck.line ? "We couldn't get past the setup" : "The app wouldn't let us in";
  const after = kept
    ? `Making tests stopped there. ${plural(kept, "test")} made before it ${kept === 1 ? "is" : "are"} kept${left ? `, and ${plural(left, "goal")} ${left === 1 ? "wasn't" : "weren't"} tried` : ""}.`
    : "Every test starts with the setup, so no tests were made.";

  return (
    <section role="status" className="flex flex-col gap-5 rounded-xl border bg-card p-5 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <Tile icon={TriangleAlert} tint="warn" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-base font-semibold text-pretty">{title}</h2>
          <p className="text-pretty text-muted-foreground">{after}</p>
        </div>
      </div>

      <dl className="flex flex-col gap-3 sm:pl-12">
        <Part label="What happened">{funds ? `${chain ?? "This chain"} can't be forked, so tests sign there for real. This app has no funded key and no note on how to get test funds, so the wallet wasn't connected.` : stuck.reason}</Part>
        {!funds && stuck.sentence && (
          <Part label="It stopped at">
            <span title={stuck.sentence} className="line-clamp-2">
              “{stuck.sentence}”
            </span>
          </Part>
        )}
        <Part label="What to do">{funds ? "Add a private key that holds test tokens there, or say how to get test funds (also when the test wallet already holds some). Then make the tests again." : "Check the setup's steps, or add a note on how to get in. Then make the tests again."}</Part>
      </dl>

      <div className="flex flex-wrap items-center gap-2 sm:pl-12">
        <Button asChild size="sm">
          <Link href={`/apps/${appId}/settings#${funds ? "funding" : "setup"}`}>{funds ? "Set up test funds" : "Open the setup"}</Link>
        </Button>
        {canMake && (
          <form action={makeTestsAction.bind(null, appId)}>
            <SubmitButton variant="outline" size="sm" busy="Starting…">
              Make the tests again
            </SubmitButton>
          </form>
        )}
      </div>
    </section>
  );
}
