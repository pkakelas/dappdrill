import { Bug, Compass, ListChecks, type LucideIcon } from "lucide-react";
import { Tile, type TINT } from "@/components/tests/tile";

export type Kind = "tests" | "checks" | "bugs";

/** What exploring an app gives back. The app page's tabs carry the same three names and icons. */
export const KIND: Record<Kind, { icon: LucideIcon; tint: keyof typeof TINT; label: string; what: string }> = {
  tests: { icon: ListChecks, tint: "live", label: "Tests", what: "User flows, run again on every change" },
  checks: { icon: Compass, tint: "fork", label: "Checks", what: "One-off checks while exploring" },
  bugs: { icon: Bug, tint: "bad", label: "Bugs", what: "What either one finds wrong" },
};

const KINDS = Object.keys(KIND) as Kind[];

/** The three, each in a line, with how many there are so far when that is known. */
export function Outcomes({ counts }: { counts?: Record<Kind, number> }) {
  return (
    <ul className="flex flex-col gap-3">
      {KINDS.map((kind) => {
        const { icon, tint, label, what } = KIND[kind];
        return (
          <li key={kind} className="flex items-center gap-3">
            <Tile icon={icon} tint={tint} />
            <p className="flex min-w-0 flex-col">
              <span className="text-sm leading-snug font-medium">
                {label}
                {counts && <span className="pl-1.5 font-normal text-muted-foreground tabular-nums">{counts[kind]}</span>}
              </span>
              <span className="text-xs text-pretty text-muted-foreground">{what}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
