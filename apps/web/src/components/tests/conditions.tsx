"use client";

import { OFFERED_CONDITIONS, type EdgeCaseId } from "@dappdrill/core";
import { Check, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { addConditionsAction } from "@/actions/tests";
import { cx } from "@/components/ui";
import { Button } from "@/components/ui/button";

const CHIP = "inline-flex h-7 items-center gap-1 rounded-full text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Pick what goes wrong at this signature, as chips; the new conditions run right away. */
export function AddConditions({ testId, existing, startOpen = false }: { testId: string; existing: EdgeCaseId[]; startOpen?: boolean }) {
  const available = OFFERED_CONDITIONS.filter((c) => !existing.includes(c.id));
  const usual = available.filter((c) => c.default);
  const [open, setOpen] = useState(startOpen);
  const [more, setMore] = useState(false);
  const [picked, setPicked] = useState<EdgeCaseId[]>(() => usual.map((c) => c.id));
  const [hovered, setHovered] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  if (available.length === 0) return null;

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={cx(CHIP, "pr-3 pl-1.5 text-muted-foreground hover:bg-accent hover:text-foreground")}>
        <Plus className="size-3.5" aria-hidden="true" />
        {existing.length ? "What else could go wrong?" : "What if it goes wrong?"}
      </button>
    );

  const shown = more || usual.length === 0 ? available : usual;
  const chosen = picked.filter((id) => available.some((c) => c.id === id));
  return (
    <form
      className="order-last flex basis-full flex-col gap-3 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await addConditionsAction(testId, chosen);
          if (r.error) return setError(r.error);
          setOpen(false);
        });
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {shown.map((c) => {
          const on = chosen.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              disabled={pending}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== c.id) : [...p, c.id]))}
              onMouseEnter={() => setHovered(c.expected)}
              onMouseLeave={() => setHovered(undefined)}
              onFocus={() => setHovered(c.expected)}
              onBlur={() => setHovered(undefined)}
              className={cx(CHIP, on ? "bg-foreground/10 pr-3 pl-2 text-foreground" : "bg-muted/70 px-3 text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {on && <Check className="size-3.5" aria-hidden="true" />}
              {c.name}
            </button>
          );
        })}
        {shown.length < available.length && (
          <button type="button" onClick={() => setMore(true)} className={cx(CHIP, "px-3 text-muted-foreground hover:bg-accent hover:text-foreground")}>
            {available.length - shown.length} more
          </button>
        )}
      </div>
      {/* Two lines held open so the buttons don't move as the pointer crosses the chips. */}
      <p className="min-h-10 text-sm leading-snug text-muted-foreground">{hovered ?? "Runs these steps under each condition and checks the app copes."}</p>
      {error && <p className="text-sm text-bad">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending || chosen.length === 0}>
          {pending ? "Adding…" : `Add and run${chosen.length ? ` ${chosen.length}` : ""}`}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
