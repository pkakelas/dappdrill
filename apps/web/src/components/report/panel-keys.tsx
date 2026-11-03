"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function PanelKeys({ closeHref }: { closeHref: string }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the drawer so keyboard and screen-reader users land on it.
    const opener = document.activeElement as HTMLElement | null;
    document.getElementById("side-panel")?.focus({ preventScroll: true });
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [closeHref, router]);
  return null;
}
