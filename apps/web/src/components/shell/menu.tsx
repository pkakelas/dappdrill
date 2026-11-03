"use client";

import type { ReactNode } from "react";
import { cx, Popover } from "@/components/ui";

/** A menu in the header: a Popover that closes when an item is chosen. */
export function Menu({ label, button, children, align = "left", buttonClassName }: { label: string; button: ReactNode; children: ReactNode; align?: "left" | "right"; buttonClassName?: string }) {
  return (
    <Popover menu label={label} button={button} align={align} buttonClassName={buttonClassName}>
      {children}
    </Popover>
  );
}

export function MenuItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="none" className={cx("px-1.5", className)}>
      {children}
    </div>
  );
}

export const menuLinkClass = "flex w-full cursor-pointer flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left text-body text-ink no-underline transition-colors hover:bg-sub hover:text-ink";
