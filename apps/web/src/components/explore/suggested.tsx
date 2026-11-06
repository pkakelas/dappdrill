import { Line } from "@/components/tests/condition-branches";
import { cx } from "@/components/ui";
import type { SuggestedTest } from "@/lib/explore";
import { AddSuggested } from "./controls";

/** A test that isn't one yet: a dashed outline where a result would be, filled while the pass is on it. */
function Mark({ now }: { now: SuggestedTest["now"] }) {
  return (
    <span aria-hidden="true" className={cx("inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-dashed", now ? "border-live/40 bg-live-soft" : "border-foreground/20")}>
      {now === "trying" && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-50 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2 rounded-full bg-live" />
        </span>
      )}
      {now === "worked" && <span className="size-2 rounded-full bg-live" />}
    </span>
  );
}

const NOW_LABEL = { trying: "Trying now", worked: "Worked once" } as const;

/**
 * Tests the pass wrote but hasn't proved. While it runs they move up into the list as they pass;
 * once it ends, what is left is yours to add.
 */
export function Suggested({ tests, passId, running }: { tests: SuggestedTest[]; passId: string; running: boolean }) {
  if (tests.length === 0) return null;
  return (
    <section aria-labelledby="suggested" className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="suggested" className="text-sm font-medium">
            Suggested <span className="font-normal text-muted-foreground tabular-nums">{tests.length}</span>
          </h2>
          <p className="text-sm text-muted-foreground">{running ? "Each one becomes a test when it passes on a clean fork." : "Not proved yet. Add one and it runs as a draft."}</p>
        </div>
        {!running && tests.length > 1 && <AddSuggested passId={passId} label="Add all" />}
      </div>
      <ul className="divide-y divide-dashed rounded-xl border border-dashed">
        {tests.map((t) => {
          // Once the pass has ended nothing is being tried: what worked for an explorer is only a fact about it.
          const now = running ? t.now : undefined;
          return (
            <li key={t.id} className="p-1.5">
              <Line
                className="min-h-11 py-2"
                mark={<Mark now={now} />}
                name={
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="min-w-0 text-pretty">{t.name}</span>
                    {t.note && !now && <span className="truncate text-xs text-muted-foreground">{t.note}</span>}
                  </div>
                }
                status={
                  <span className="flex items-center gap-2">
                    {now ? <span className="text-live">{NOW_LABEL[now]}</span> : t.now === "worked" && <span>Worked once ·</span>}
                    <span>{t.feature}</span>
                  </span>
                }
                action={!running && <AddSuggested passId={passId} id={t.id} label="Add" />}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
