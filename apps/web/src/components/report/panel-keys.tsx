"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** The ?panel=… drawer: always open while rendered; closing (X, Escape, overlay) drops the param. */
export function PanelSheet({ title, eyebrow, closeHref, children }: { title: ReactNode; eyebrow?: ReactNode; closeHref: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <Sheet open onOpenChange={(open) => !open && router.push(closeHref, { scroll: false })}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="sticky top-0 z-10 border-b bg-background px-6 py-4 pr-12">
          {eyebrow ? (
            <SheetDescription asChild>
              <div className="flex flex-wrap items-center gap-2">{eyebrow}</div>
            </SheetDescription>
          ) : (
            <SheetDescription className="sr-only">Details</SheetDescription>
          )}
          <SheetTitle className="text-lg leading-snug">{title}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-6 py-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
