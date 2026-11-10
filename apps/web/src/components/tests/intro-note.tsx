"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui";

const TONE = {
  good: { box: "border-good-bg bg-good-soft text-good-ink", tile: "bg-good-bg text-good" },
  live: { box: "border-live-bg bg-live-soft text-live-ink", tile: "bg-live-bg text-live" },
};

/**
 * A note at the top of the page that reads like a notification: an icon, a title and its lines, and
 * a close button. Closed stays closed in this browser, by `id`.
 */
export function IntroNote({ id, tint, icon, title, children }: { id: string; tint: keyof typeof TONE; icon: ReactNode; title: ReactNode; children: ReactNode }) {
  const key = `dd-note:${id}`;
  const [closed, setClosed] = useState(false);
  useEffect(() => setClosed(localStorage.getItem(key) === "closed"), [key]);
  if (closed) return null;
  const tone = TONE[tint];
  return (
    <div role="status" className={cx("relative flex items-start gap-3.5 rounded-xl border py-3.5 pr-12 pl-3.5 text-left text-sm shadow-xs", tone.box)}>
      <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4", tone.tile)}>{icon}</span>
      <div className="flex min-w-0 flex-col gap-1 pt-1">
        <p className="font-medium">{title}</p>
        <div className="text-pretty opacity-90">{children}</div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Close"
        onClick={() => {
          localStorage.setItem(key, "closed");
          setClosed(true);
        }}
        className="absolute top-2 right-2 size-7 text-current opacity-60 hover:bg-black/5 hover:text-current hover:opacity-100"
      >
        <X />
      </Button>
    </div>
  );
}
