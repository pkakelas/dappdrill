import { describeStep, type Flow } from "@dappdrill/core";
import { cx } from "@/components/common";
import { Badge } from "@/components/ui/badge";

/** Renders text with {{param}} placeholders as param chips. */
export function WithParams({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[\w-]+\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([\w-]+)\s*\}\}$/);
        return m ? (
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">
            {m[1]}
          </code>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

export function WalletBadge() {
  return (
    <Badge variant="outline" className="rounded-md">
      Wallet
    </Badge>
  );
}

/** Read-only numbered steps; with `before`, marks added/changed lines. */
export function StepsPreview({ flow, before }: { flow: Flow; before?: Flow }) {
  const old = before?.steps.map((s) => describeStep(s)) ?? null;
  return (
    <ol className="divide-y rounded-lg border">
      {flow.steps.map((s, i) => {
        const text = describeStep(s);
        const changed = old && old[i] !== text;
        return (
          <li key={i} className={cx("grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 px-4 py-2.5", changed && "bg-live-soft")}>
            <span className={cx("font-mono text-xs leading-5", changed ? "text-live-ink" : "text-muted-foreground")}>
              {changed ? (old && i >= old.length ? "+" : "~") : ""}
              {i + 1}
            </span>
            <span>
              <WithParams text={text} />
              {s.optional && <span className="text-muted-foreground"> (optional)</span>}
              {changed && old?.[i] && <span className="mt-0.5 block text-muted-foreground line-through">{old[i]}</span>}
            </span>
            {s.kind === "wallet" ? <WalletBadge /> : <span />}
          </li>
        );
      })}
      {old && old.length > flow.steps.length && (
        <li className="px-4 py-2.5 text-muted-foreground">
          Removes {old.length - flow.steps.length} {old.length - flow.steps.length === 1 ? "step" : "steps"} at the end.
        </li>
      )}
    </ol>
  );
}
