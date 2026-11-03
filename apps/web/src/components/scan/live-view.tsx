"use client";

import { chainName, SCAN_STAGE_LABEL, type FlowLiveStatus, type ScanStage, type WalletRequest } from "@dappdrill/core";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { stopScanAction } from "@/actions/scan";
import { cx, PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TERMINAL, type LiveEvent, type ScanSnapshot } from "@/lib/live";

const STAGES: ScanStage[] = ["map", "flows", "edge-cases", "signing"];

const FLOW_STATUS: Record<FlowLiveStatus, { label: string; cls: string }> = {
  queued: { label: "Queued", cls: "text-muted-foreground" },
  running: { label: "Running", cls: "text-live-ink" },
  tested: { label: "Tested", cls: "text-muted-foreground" },
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title={
          <>
            Scanning <span className="font-mono break-all">{host}</span>
          </>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1" suppressHydrationWarning>
            <span className={cx("size-2 rounded-full", running ? "animate-pulse bg-live" : "bg-muted-foreground/40")} />
            {snap.status === "queued" ? "Waiting for a worker" : startedAt ? `Running for ${elapsed(now - startedAt)}` : "Starting"}
            <span aria-hidden="true">·</span>
            {chainLabel}
            {snap.costUsd > 0 && (
              <>
                <span aria-hidden="true">·</span>${snap.costUsd.toFixed(2)} model cost
              </>
            )}
            {derived.issues > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-bad">{derived.issues === 1 ? "1 issue" : `${derived.issues} issues`} so far</span>
              </>
            )}
          </span>
        }
        actions={
          <form action={() => startStop(() => stopScanAction(scanId).then(() => setSnap((s) => ({ ...s, stopRequested: true }))))}>
            <Button type="submit" variant="outline" disabled={snap.stopRequested || stopping}>
              {snap.stopRequested ? "Stopping…" : "Stop scan"}
            </Button>
          </form>
        }
      />

      <ol aria-label="Scan stages" className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {STAGES.map((st) => {
          const s = snap.stages[st];
          return (
            <li key={st} className="flex flex-col gap-1.5">
              <Progress value={s?.status === "done" ? 100 : Math.round((s?.progress ?? 0) * 100)} className={cx("h-1", s?.status !== "done" && "[&>div]:bg-live")} />
              <span className={cx("font-medium", !s && "text-muted-foreground")}>{SCAN_STAGE_LABEL[st]}</span>
              <span className="text-xs text-muted-foreground">{s?.status === "done" ? `${stageNote[st]} · done` : s ? stageNote[st] : "Waiting"}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card aria-label="Live view" className="gap-0 overflow-hidden py-0">
          <div className="truncate border-b bg-muted/50 px-4 py-2 font-mono text-xs text-muted-foreground">{frameUrl}</div>
          <div className="relative flex aspect-[16/10] items-center justify-center bg-muted/30">
            {frameSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={frameSrc} alt="What the scanner's browser shows right now" className="h-full w-full object-contain" />
            ) : (
              <span className="text-muted-foreground">{snap.status === "queued" ? "Waiting for the browser to start…" : "Loading the first frame…"}</span>
            )}
            {showSign && derived.lastSign && (
              <div className="absolute top-4 right-4 flex w-[280px] max-w-[calc(100%-32px)] flex-col gap-2 rounded-lg border bg-popover p-4 shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Signature request</span>
                  <Badge variant="secondary" className="bg-live-bg text-live-ink">
                    {chainName(derived.lastSign.req.chainId)}
                  </Badge>
                </div>
                <div className="font-mono font-medium break-all">{derived.lastSign.req.method}</div>
                {derived.lastSign.req.from && (
                  <div className="text-xs text-muted-foreground">
                    From <span className="font-mono">{shortAddr(derived.lastSign.req.from)}</span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">{derived.lastSign.req.outcome === "pending" ? "Waiting for the wallet" : `Wallet ${derived.lastSign.req.outcome}`}</div>
              </div>
            )}
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-6">
          <Card className="gap-0 pb-0">
            <CardHeader className="pb-4">
              <CardTitle id="log">What it&apos;s doing</CardTitle>
            </CardHeader>
            {derived.log.length === 0 ? (
              <CardContent className="pb-6 text-muted-foreground">Nothing yet.</CardContent>
            ) : (
              <ol aria-labelledby="log" className="max-h-[320px] divide-y overflow-y-auto border-t" aria-live="polite">
                {derived.log.map((l, i) => (
                  <li key={l.id + ":" + i} className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 px-6 py-2.5">
                    <span className={cx("font-mono text-xs leading-5", i === 0 && running ? "text-live-ink" : "text-muted-foreground")}>{startedAt ? clock(new Date(l.at).getTime() - startedAt) : "--:--"}</span>
                    <span className={cx("break-words", l.tone === "bad" && "font-medium text-bad", l.tone === "warn" && "text-warn")}>{l.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="gap-0 pb-0">
            <CardHeader className="pb-4">
              <CardTitle id="found">Flows found{derived.flows.length > 0 && <span className="font-normal text-muted-foreground"> · {derived.flows.length}</span>}</CardTitle>
            </CardHeader>
            {derived.flows.length === 0 ? (
              <CardContent className="pb-6 text-muted-foreground">None yet. Mapping the site first.</CardContent>
            ) : (
              <ul aria-labelledby="found" className="divide-y border-t">
                {derived.flows.map(([id, f]) => (
                  <li key={id} className="flex justify-between gap-3 px-6 py-2.5">
                    <span className={cx("min-w-0 truncate", f.status === "running" && "font-medium")}>{f.name}</span>
                    <span className={FLOW_STATUS[f.status].cls}>{FLOW_STATUS[f.status].label}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
