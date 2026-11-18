"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { TINT } from "./tile";

/** Tints that say nothing about a result, so an initial never reads as passed or failed. */
const INITIAL = [TINT.violet, TINT.pink, TINT.live];

/**
 * The app's own icon, the one its site declares, over its initial: the initial shows until the icon has loaded,
 * and stays when the site has none.
 */
export function AppIcon({ appId, name, className }: { appId: string; name: string; className?: string }) {
  // Loaded after hydration, so its load and error events are never missed.
  const [src, setSrc] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setSrc(`/api/apps/${appId}/icon`), [appId]);
  const tint = INITIAL[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % INITIAL.length];
  return (
    <span aria-hidden="true" className={cx("relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl", loaded ? "border bg-card shadow-xs" : tint, className)}>
      {!loaded && <span className="text-2xl font-semibold uppercase">{name.trim().charAt(0) || "?"}</span>}
      {src && (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onLoad={(e) => setLoaded(e.currentTarget.naturalWidth > 0)}
          onError={() => setSrc(undefined)}
          className={cx("size-8 object-contain", !loaded && "absolute opacity-0")}
        />
      )}
    </span>
  );
}
