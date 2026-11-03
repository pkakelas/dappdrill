import type { ConsoleEntry, RpcLogEntry } from "@dappdrill/core";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "@/components/common";
import { plural } from "@/lib/format";
import { PanelSection } from "./side-panel";

export function Video({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    <PanelSection title="Replay">
      <video src={src} controls preload="metadata" className="w-full rounded-lg border bg-black" />
    </PanelSection>
  );
}

export function Screenshot({ src, alt, title = "Screenshot" }: { src: string | null; alt: string; title?: string }) {
  if (!src) return null;
  return (
    <PanelSection title={title}>
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full rounded-lg border" />
      </a>
    </PanelSection>
  );
}

const time = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 19);
};

function Collapsible({ title, summary, children }: { title: string; summary: string; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-lg border">
      <summary className="flex items-center justify-between gap-3 px-4 py-3 font-medium hover:bg-muted/50">
        {title}
        <span className="flex items-center gap-2 font-normal text-muted-foreground">
          {summary}
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="max-h-80 overflow-auto border-t">{children}</div>
    </details>
  );
}

export function ConsoleLog({ entries }: { entries?: ConsoleEntry[] }) {
  if (!entries?.length) return null;
  const problems = entries.filter((e) => e.level === "error" || e.level === "pageerror" || e.level === "warn").length;
  return (
    <Collapsible title="Console" summary={`${plural(entries.length, "line")}${problems ? ` · ${plural(problems, "warning or error", "warnings or errors")}` : ""}`}>
      <ol className="divide-y font-mono text-xs">
        {entries.map((e, i) => (
          <li key={i} className={cx("grid grid-cols-[64px_minmax(0,1fr)] gap-3 px-4 py-1.5 break-words", (e.level === "error" || e.level === "pageerror") && "bg-bad-soft text-bad-ink", e.level === "warn" && "bg-warn-soft text-warn-ink")}>
            <span className="text-muted-foreground">{time(e.at)}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </Collapsible>
  );
}

export function RpcLog({ entries }: { entries?: RpcLogEntry[] }) {
  if (!entries?.length) return null;
  const failed = entries.filter((e) => e.error).length;
  return (
    <Collapsible title="RPC calls" summary={`${plural(entries.length, "call")}${failed ? ` · ${failed} failed` : ""}`}>
      <table className="w-full font-mono text-xs">
        <tbody className="divide-y">
          {entries.map((e, i) => (
            <tr key={i} className={cx(e.error && "bg-bad-soft text-bad-ink")}>
              <td className="px-4 py-1.5 text-muted-foreground">{time(e.at)}</td>
              <td className="px-2 py-1.5">{e.method}</td>
              <td className="px-2 py-1.5 text-muted-foreground">{e.via}</td>
              <td className="px-2 py-1.5 text-right text-muted-foreground">{Math.round(e.durationMs)} ms</td>
              <td className="px-4 py-1.5">{e.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Collapsible>
  );
}
