import { describeStep, type Flow } from "@dappdrill/core";
import { cx } from "@/components/ui";

/** Renders text with {{param}} placeholders as param chips. */
export function WithParams({ text }: { text: string }) {
  const parts = text.split(/(\{\{\s*[\w-]+\s*\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = p.match(/^\{\{\s*([\w-]+)\s*\}\}$/);
        return m ? (
          <span key={i} className="param">
            {m[1]}
          </span>
        ) : (
          <span key={i}>{p}</span>
        );
      })}
    </>
  );
}

/** Read-only numbered steps; with `before`, marks added/changed lines. */
export function StepsPreview({ flow, before }: { flow: Flow; before?: Flow }) {
  const old = before?.steps.map((s) => describeStep(s)) ?? null;
  return (
    <ol className="list">
      {flow.steps.map((s, i) => {
        const text = describeStep(s);
        const changed = old && old[i] !== text;
        return (
          <li key={i} className={cx("grid grid-cols-[28px_minmax(0,1fr)_auto] gap-3 px-4 py-3", changed && "bg-sub")}>
            <span className={cx("font-mono text-meta", changed ? "font-medium text-ink" : "text-faint")} title={changed ? (old && i >= old.length ? "Added" : "Changed") : undefined}>{changed ? (old && i >= old.length ? "+" : "~") : ""}{String(i + 1).padStart(2, "0")}</span>
            <span className="text-sm">
              <WithParams text={text} />
              {s.optional && <span className="meta"> (optional)</span>}
              {changed && old?.[i] && <span className="meta mt-0.5 block line-through">{old[i]}</span>}
            </span>
            {s.kind === "wallet" ? <span className="tag bg-hair text-ink-2">Wallet</span> : <span />}
          </li>
        );
      })}
      {old && old.length > flow.steps.length && (
        <li className="meta px-4 py-3">
          Removes {old.length - flow.steps.length} {old.length - flow.steps.length === 1 ? "step" : "steps"} at the end.
        </li>
      )}
    </ol>
  );
}
