"use client";

import { useState } from "react";
import { CheckIcon, cx } from "@/components/ui";

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cx("btn btn-sm", className)}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
    >
      <span aria-live="polite" className="inline-flex items-center gap-1.5">
        {copied ? (
          <>
            <CheckIcon /> Copied
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}
