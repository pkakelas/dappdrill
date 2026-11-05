import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export const TINT = {
  good: "bg-emerald-500/10 text-emerald-600",
  bad: "bg-rose-500/10 text-rose-600",
  warn: "bg-amber-500/10 text-amber-600",
  live: "bg-sky-500/10 text-sky-600",
  fork: "bg-violet-500/10 text-violet-600",
  pink: "bg-pink-500/10 text-pink-600",
  quiet: "bg-muted text-muted-foreground",
};

/** The tinted icon square from the New app page. */
export function Tile({ icon: Icon, tint, className }: { icon: LucideIcon; tint: keyof typeof TINT; className?: string }) {
  return (
    <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-lg", TINT[tint], className)}>
      <Icon className="size-[18px]" aria-hidden="true" />
    </span>
  );
}

/** A section's heading, the way the New app page labels its rows: a tile, a title and a line of detail. */
export function SectionHead({ icon, tint, title, detail, action }: { icon: LucideIcon; tint: keyof typeof TINT; title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <Tile icon={icon} tint={tint} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h2 className="text-sm leading-snug font-medium">{title}</h2>
        {detail && <p className="text-sm text-pretty text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}
