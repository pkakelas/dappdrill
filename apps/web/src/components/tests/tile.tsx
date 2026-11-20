import type { LucideIcon } from "lucide-react";
import { cx } from "@/components/ui";

export const TINT = {
  good: "bg-emerald-500/10 text-emerald-600",
  warn: "bg-amber-500/10 text-amber-600",
  live: "bg-sky-500/10 text-sky-600",
  violet: "bg-violet-500/10 text-violet-600",
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
