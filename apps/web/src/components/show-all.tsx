"use client";

import { Children, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** A list that shows its first few items, and the rest once asked. `children` are its `<li>`s. */
export function ShowAll({ first, className, children }: { first: number; className?: string; children: ReactNode }) {
  const [all, setAll] = useState(false);
  const items = Children.toArray(children);
  return (
    <div className="flex flex-col items-start gap-2">
      <ul className={className}>{all ? items : items.slice(0, first)}</ul>
      {items.length > first && (
        <Button type="button" variant="ghost" size="sm" aria-expanded={all} onClick={() => setAll(!all)} className="-ml-1 text-muted-foreground">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      )}
    </div>
  );
}
