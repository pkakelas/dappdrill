"use client";

import { chainName, SCAN_STAGE_LABEL, type FlowLiveStatus, type ScanStage, type WalletRequest } from "@dappdrill/core";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { stopScanAction } from "@/actions/scan";
import { cx } from "@/components/ui";
import { TERMINAL, type LiveEvent, type ScanSnapshot } from "@/lib/live";

const STAGES: ScanStage[] = ["map", "flows", "edge-cases", "signing"];

const FLOW_STATUS: Record<FlowLiveStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "text-muted" },
  running: { label: "Running", cls: "text-live-ink" },
  tested: { label: "Tested", cls: "text-muted" },
  issue: { label: "Issue", cls: "text-bad" },
  failed: { label: "Failed", cls: "text-bad" },
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return m ? `${m} min ${s % 60} s` : `${s} s`;
}

function shortAddr(a?: string) {
  return a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? "");
}

export function LiveView({ scanId, host, initialEvents, initialSnapshot, frameBase }: { scanId: string; host: string; initialEvents: LiveEvent[]; initialSnapshot: ScanSnapshot; frameBase: string }) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [snap, setSnap] = useState(initialSnapshot);
  const [now, setNow] = useState(() => Date.now());
  const [stopping, startStop] = useTransition();

  useEffect(() => {
    const after = initialEvents.at(-1)?.id ?? 0;
    const es = new EventSource(`/api/scans/${scanId}/events?after=${after}`);
    es.addEventListener("events", (e) => {
      const batch = JSON.parse((e as MessageEvent).data) as LiveEvent[];
      setEvents((prev) => {
        const last = prev.at(-1)?.id ?? 0;
        return [...prev, ...batch.filter((x) => x.id > last)].slice(-2000);
      });
    });
    es.addEventListener("snapshot", (e) => setSnap(JSON.parse((e as MessageEvent).data) as ScanSnapshot));
    es.addEventListener("end", () => {
      es.close();
      router.refresh();
    });
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      es.close();
      clearInterval(tick);
    };
  }, [scanId, initialEvents, router]);

  useEffect(() => {
    if (TERMINAL.includes(snap.status)) router.refresh();
  }, [snap.status, router]);

  const derived = useMemo(() => {
    const flows = new Map<string, { name: string; status: FlowLiveStatus }>();
    const log: { id: number; at: string; text: string; tone?: "bad" | "warn" | "live" }[] = [];
    let frame: { path: string; url: string; id: number } | null = null;
    let lastSign: { req: WalletRequest; id: number } | null = null;
    let issues = 0;
    let signs = 0;
    let pages = 0;
    let runs = 0;
    let chains = snap.chains;
    for (const { id, at, event: e } of events) {
      switch (e.type) {
        case "log":
          log.push({ id, at: e.at ?? at, text: e.message, tone: e.level === "error" ? "bad" : e.level === "warn" ? "warn" : undefined });
          break;
        case "frame":
          frame = { path: e.path, url: e.url, id };
          break;
        case "flow":
          flows.set(e.flow.id, { name: e.flow.name, status: flows.get(e.flow.id)?.status ?? "queued" });
          log.push({ id, at, text: `Found flow: ${e.flow.name}` });
          break;
        case "flow-status": {
          const f = flows.get(e.flowId);
          flows.set(e.flowId, { name: f?.name ?? "Flow", status: e.status });
          break;
        }
        case "wallet-request":
          if (e.request.kind === "sign") {
            signs++;
            lastSign = { req: e.request, id };
          }
          break;
        case "issue":
          issues++;
          log.push({ id, at, text: `Issue: ${e.issue.title}`, tone: e.issue.severity === "critical" || e.issue.severity === "high" ? "bad" : "warn" });
          break;
        case "page":
          pages++;
          break;
        case "run":
          runs++;
          break;
        case "chains":
          chains = e.chains.map((c) => ({ id: c.id, name: c.name, mode: c.mode }));
          break;
      }
    }
    return { flows: [...flows.entries()], log: log.reverse().slice(0, 40), frame, lastSign, issues, signs, pages: Math.max(pages, snap.pages), runs, chains };
  }, [events, snap.pages, snap.chains]);

  const startedAt = snap.startedAt ? new Date(snap.startedAt).getTime() : null;
  const frameSrc = derived.frame ? `${frameBase}/${derived.frame.path}?v=${derived.frame.id}` : snap.liveFrame ? `${frameBase}/${snap.liveFrame}` : null;
  const frameUrl = derived.frame?.url.replace(/^https?:\/\//, "") ?? host;
  const showSign = derived.lastSign && (!derived.frame || derived.lastSign.id >= derived.frame.id - 3);
  const running = snap.status === "running";
  const chainLabel = derived.chains.length ? derived.chains.map((c) => `${c.name ?? chainName(c.id)} ${c.mode}`).join(", ") : "Detecting chains";
  const stageNote: Record<ScanStage, string> = {
    map: `${derived.pages} pages`,
    flows: `${derived.flows.length} found`,
    "edge-cases": `${derived.runs} runs`,
    signing: `${derived.signs} requests`,
  };

  return (
    <div className="flex flex-col gap-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="h1">
            Scanning <span className="font-mono text-[23px] font-medium break-all sm:text-[27px]">{host}</span>
          </h1>
          <p className="m-0 flex flex-wrap items-center gap-2.5 text-sm text-ink-3">
            <span className="inline-flex items-center gap-2" suppressHydrationWarning>
              <span className={cx("size-2 rounded-full", running ? "animate-pulse bg-live" : "bg-quiet")} />
              {snap.status === "queued" ? "Waiting for a worker" : startedAt ? `Running for ${elapsed(now - startedAt)}` : "Starting"}
            </span>
            <span aria-hidden="true">·</span>
            <span>{chainLabel}</span>
            {snap.costUsd > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span>${snap.costUsd.toFixed(2)} model cost</span>
              </>
            )}
          </p>
        </div>
        <form action={() => startStop(() => stopScanAction(scanId).then(() => setSnap((s) => ({ ...s, stopRequested: true }))))}>
          <button type="submit" className="btn" disabled={snap.stopRequested || stopping}>
            {snap.stopRequested ? "Stopping…" : "Stop scan"}
          </button>
        </form>
      </header>

      <ol aria-label="Scan stages" className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-4 p-0 sm:grid-cols-4">
        {STAGES.map((st) => {
          const s = snap.stages[st];
          return (
            <li key={st} className="flex flex-col gap-2">
              <div className="h-1 rounded-sm bg-divide">
                <div className={cx("h-1 rounded-sm transition-all", s?.status === "done" ? "bg-ink" : "bg-live")} style={{ width: s?.status === "done" ? "100%" : `${Math.round((s?.progress ?? 0) * 100)}%` }} />
              </div>
              <span className={cx("text-[13px] font-medium", !s && "text-ink-3")}>{SCAN_STAGE_LABEL[st]}</span>
              <span className="text-xs text-muted">{s?.status === "done" ? `${stageNote[st]} · done` : s ? stageNote[st] : "Waiting"}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-start gap-6">
        <section aria-label="Live view" className="flex min-w-0 flex-[3_1_520px] flex-col gap-3">
          <div className="overflow-hidden rounded-xl border border-line-strong bg-card">
            <div className="flex items-center gap-3 border-b border-divide bg-sub px-3.5 py-2.5">
              <div className="flex gap-1.5" aria-hidden="true">
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
              </div>
              <div className="flex h-7 min-w-0 flex-1 items-center truncate rounded-md border border-divide bg-card px-3 font-mono text-xs text-ink-3">{frameUrl}</div>
            </div>
            <div className="relative flex aspect-[16/10] items-center justify-center bg-sub">
              {frameSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={frameSrc} alt="What the scanner's browser shows right now" className="h-full w-full object-contain" />
              ) : (
                <span className="text-sm text-muted">{snap.status === "queued" ? "Waiting for the browser to start…" : "Loading the first frame…"}</span>
              )}
              {showSign && derived.lastSign && (
                <div className="absolute top-4 right-4 flex w-[280px] max-w-[calc(100%-32px)] flex-col gap-2.5 rounded-xl border border-ink bg-card p-4 shadow-[0_8px_24px_rgba(23,24,28,0.12)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold tracking-[0.04em] text-ink-3 uppercase">Signature request</span>
                    <span className="pill bg-live-bg px-2 py-0.5 text-[11px] text-live-ink">{chainName(derived.lastSign.req.chainId)}</span>
                  </div>
                  <div className="font-mono text-sm font-medium break-all">{derived.lastSign.req.method}</div>
                  {derived.lastSign.req.from && <div className="text-xs text-muted">From <span className="font-mono">{shortAddr(derived.lastSign.req.from)}</span></div>}
                  <div className="text-xs text-muted">{derived.lastSign.req.outcome === "pending" ? "Waiting for the wallet" : `Wallet ${derived.lastSign.req.outcome}`}</div>
                </div>
              )}
            </div>
          </div>
        </section>

        <aside className="flex min-w-0 flex-[2_1_320px] flex-col gap-5">
          <div className="grid grid-cols-3 gap-2">
            {[
              { v: derived.flows.length, l: "flows found" },
              { v: derived.signs, l: "sign requests" },
              { v: derived.issues, l: "issues so far", bad: derived.issues > 0 },
            ].map((s) => (
              <div key={s.l} className="rounded-[10px] border border-line bg-card p-3.5">
                <div className={cx("text-2xl font-semibold", s.bad && "text-bad")}>{s.v}</div>
                <div className="text-xs text-muted">{s.l}</div>
              </div>
            ))}
          </div>

          <section aria-labelledby="log" className="flex flex-col gap-2.5">
            <h2 id="log" className="eyebrow">
              What it&apos;s doing
            </h2>
            {derived.log.length === 0 ? (
              <p className="hint m-0">Nothing yet.</p>
            ) : (
              <ol className="m-0 max-h-[360px] list-none overflow-y-auto rounded-[10px] border border-line bg-card p-0" aria-live="polite">
                {derived.log.map((l, i) => (
                  <li key={l.id + ":" + i} className={cx("grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-divide px-3.5 py-3 last:border-b-0", i === 0 && running && "bg-live-soft")}>
                    <span className={cx("font-mono text-xs", i === 0 && running ? "text-live-ink" : "text-muted")}>{startedAt ? clock(new Date(l.at).getTime() - startedAt) : "--:--"}</span>
                    <span className={cx("text-[13px] leading-snug break-words", l.tone === "bad" && "font-semibold text-bad", l.tone === "warn" && "text-warn")}>{l.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section aria-labelledby="found" className="flex flex-col gap-2.5">
            <h2 id="found" className="eyebrow">
              Flows found
            </h2>
            {derived.flows.length === 0 ? (
              <p className="hint m-0">None yet. Mapping the site first.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col p-0 text-[13px]">
                {derived.flows.map(([id, f]) => (
                  <li key={id} className="flex justify-between gap-3 border-b border-divide px-0.5 py-2 last:border-b-0">
                    <span className={cx("min-w-0 truncate", f.status === "running" && "font-medium")}>{f.name}</span>
                    <span className={FLOW_STATUS[f.status].cls}>{FLOW_STATUS[f.status].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
