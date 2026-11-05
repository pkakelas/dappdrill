"use client";

import { Globe, Lock } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { previewSiteAction } from "@/actions/apps";
import type { SiteInfo } from "@/lib/site";
import { cn } from "@/lib/utils";

const LOOKS_LIKE_HOST = /^(https?:\/\/)?[^\s/]+(\.[a-z]{2,}|:\d+)(\/\S*)?$/i;
const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 800;
const NEUTRAL_SITE = "color-mix(in oklab, var(--foreground) 45%, transparent)";

/** Looks the site up once typing pauses. The last site stays around so the preview can animate out with it. */
export function useSite(input: string) {
  const [site, setSite] = useState<SiteInfo>();
  const [open, setOpen] = useState(false);
  const [looking, setLooking] = useState(false);
  const [missed, setMissed] = useState(false);

  useEffect(() => {
    const text = input.trim();
    setMissed(false);
    if (!LOOKS_LIKE_HOST.test(text)) {
      setOpen(false);
      setLooking(false);
      return;
    }
    let stale = false;
    setLooking(true);
    const timer = setTimeout(async () => {
      const found = await previewSiteAction(text).catch(() => undefined);
      if (stale) return;
      setLooking(false);
      setOpen(Boolean(found));
      setMissed(!found);
      if (found) setSite(found);
    }, 600);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [input]);

  return { site, open, looking, missed };
}

/** Same-origin content with these sandbox flags could lift the sandbox, and browsers block http frames on https pages. */
function canFrame(site: SiteInfo): boolean {
  const { origin, protocol } = new URL(site.url);
  return site.framable && origin !== location.origin && !(location.protocol === "https:" && protocol === "http:");
}

/** The real site at desktop size, shrunk to fit. Sandboxed and untouchable: it's only there to be looked at. */
function LiveSite({ url }: { url: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([entry]) => setScale(Math.max(entry!.contentRect.width / FRAME_WIDTH, entry!.contentRect.height / FRAME_HEIGHT)));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className={cn("absolute inset-0 transition-opacity duration-700", loaded ? "opacity-100" : "opacity-0")}>
      <iframe
        src={url}
        title=""
        tabIndex={-1}
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
        onLoad={() => setLoaded(true)}
        className="pointer-events-none origin-top-left border-0 bg-white"
        style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `scale(${scale})` }}
      />
    </div>
  );
}

function SiteImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="absolute inset-0 size-full animate-in object-cover duration-500 fade-in-0 motion-reduce:animate-none" />;
}

/** Stands in for sites that won't be framed, and for live ones while they load. */
function Wireframe() {
  const block = "rounded-md bg-foreground/20";
  return (
    <div className="absolute inset-0 flex flex-col gap-[6%] bg-card p-[5%]">
      <div className="flex items-center gap-3">
        <div className="size-6 rounded-md bg-(--site)" />
        <div className={cn(block, "h-2.5 w-14")} />
        <div className={cn(block, "h-2.5 w-14")} />
        <div className="ml-auto h-6 w-20 rounded-full bg-(--site)" />
      </div>
      <div className="mx-auto flex w-3/5 flex-1 flex-col gap-3 rounded-xl border bg-background p-4">
        <div className={cn(block, "h-3 w-1/3")} />
        <div className={cn(block, "flex-1")} />
        <div className={cn(block, "flex-1")} />
        <div className="h-8 rounded-lg bg-(--site)" />
      </div>
    </div>
  );
}

/** A site that hasn't drawn yet: its stand-in, with the band from the New app preview passing through. */
export function SiteLoading() {
  return (
    <div className="absolute inset-0" style={{ "--site": NEUTRAL_SITE } as CSSProperties}>
      <Wireframe />
      <div className="site-wash absolute -inset-px" />
      <div className="site-beam absolute inset-0" />
    </div>
  );
}

function SiteIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Globe className="size-5 text-muted-foreground" />;
  return <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="size-full object-contain" />;
}

/** The window a site is shown in, here and on the app page while it's explored. */
export function BrowserWindow({ url, toolbar, children }: { url: string; toolbar?: ReactNode; children: ReactNode }) {
  const { host, protocol } = new URL(url);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card shadow-lg">
      <div className="flex items-center gap-3 border-b bg-muted/50 px-3 py-2">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-background px-2.5 py-1 text-xs text-muted-foreground">
          {protocol === "https:" ? <Lock className="size-3 shrink-0" /> : <Globe className="size-3 shrink-0" />}
          <span className="truncate">{host}</span>
        </div>
        {toolbar && <div className="flex shrink-0 items-center gap-2">{toolbar}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * A small browser showing the app the user just pasted. A grey wash quiets the site down to its
 * shape, and a band of real colour passes through it. The toolbar shows the wallet and chain picked in the form.
 */
export function SitePreview({ site, open, toolbar }: { site: SiteInfo; open: boolean; toolbar: ReactNode }) {
  const { host } = new URL(site.url);
  return (
    <div
      aria-hidden
      data-open={open}
      style={{ "--site": site.color ?? NEUTRAL_SITE } as CSSProperties}
      className="relative h-full transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none data-[open=false]:pointer-events-none data-[open=false]:[transform:perspective(1400px)_translateX(-3rem)_rotateY(14deg)_scale(0.94)] data-[open=false]:opacity-0 data-[open=true]:delay-150"
    >
      {site.color && <div className="absolute -inset-4 -z-10 rounded-3xl bg-(--site) opacity-20 blur-3xl" />}
      <BrowserWindow url={site.url} toolbar={toolbar}>
        <div key={site.url} className="relative aspect-[16/10] min-h-0 overflow-hidden bg-card lg:aspect-auto lg:flex-1">
          <Wireframe />
          {site.image && <SiteImage src={site.image} />}
          {canFrame(site) && <LiveSite url={site.url} />}
          <div className="site-wash absolute -inset-px" />
          <div className="site-beam absolute inset-0" />
          <div className="absolute inset-x-3 bottom-3 flex animate-in items-center gap-2.5 rounded-lg border bg-background/85 p-2 shadow-md backdrop-blur-md delay-500 duration-700 fill-mode-both fade-in-0 slide-in-from-bottom-3 motion-reduce:animate-none">
            <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-background p-1">
              <SiteIcon src={site.icon} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{site.name ?? host}</span>
              <span className="block truncate text-xs text-muted-foreground">{site.description ?? host}</span>
            </span>
          </div>
        </div>
      </BrowserWindow>
    </div>
  );
}
