/** The quiet mark on a line a run can't do yet: it has no code until the next repair writes it. */
export function NotCode() {
  return (
    <span title="A run stops at this step until a repair records it." className="shrink-0 rounded-md border border-dashed px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground">
      Needs repair
    </span>
  );
}
