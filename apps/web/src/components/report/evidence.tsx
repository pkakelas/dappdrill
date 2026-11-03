import type { ConsoleEntry, RpcLogEntry } from "@dappdrill/core";
import { cx, Disclosure } from "@/components/ui";
import { PanelSection } from "./side-panel";

export function Video({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    <PanelSection title="Replay">
      <video src={src} controls preload="metadata" className="w-full rounded-xl border border-line-strong bg-ink" />
    </PanelSection>
  );
}

export function Screenshot({ src, alt, title = "Screenshot" }: { src: string | null; alt: string; title?: string }) {
  if (!src) return null;
  return (
    <PanelSection title={title}>
      <a href={src} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className="w-full rounded-xl border border-line-strong bg-card" />
      </a>
    </PanelSection>
  );
}

const time = (at: string) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(11, 19);
};

export function ConsoleLog({ entries }: { entries?: ConsoleEntry[] }) {
  if (!entries?.length) return null;
  const problems = entries.filter((e) => e.level === "error" || e.level === "pageerror" || e.level === "warn").length;
  return (
    <Disclosure summary="Console" aside={`${entries.length} lines${problems ? ` · ${problems} warnings or errors` : ""}`}>
      <ol className="m-0 max-h-80 list-none overflow-y-auto p-0 font-mono text-xs">
        {entries.map((e, i) => (
          <li key={i} className={cx("grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-hair px-4 py-1.5 break-words", (e.level === "error" || e.level === "pageerror") && "bg-bad-soft text-bad-ink", e.level === "warn" && "bg-warn-soft text-warn-ink")}>
            <span className="text-faint">{time(e.at)}</span>
            <span>{e.text}</span>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}

export function RpcLog({ entries }: { entries?: RpcLogEntry[] }) {
  if (!entries?.length) return null;
  const failed = entries.filter((e) => e.error).length;
  return (
    <Disclosure summary="RPC calls" aside={`${entries.length} calls${failed ? ` · ${failed} failed` : ""}`}>
      <div className="max-h-80 overflow-auto">
        <table className="w-full border-collapse font-mono text-xs">
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} className={cx("border-b border-hair", e.error && "bg-bad-soft text-bad-ink")}>
                <td className="px-4 py-1.5 text-faint">{time(e.at)}</td>
                <td className="px-2 py-1.5">{e.method}</td>
                <td className="px-2 py-1.5 text-muted">{e.via}</td>
                <td className="px-2 py-1.5 text-right text-muted">{Math.round(e.durationMs)} ms</td>
                <td className="px-4 py-1.5">{e.error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}
