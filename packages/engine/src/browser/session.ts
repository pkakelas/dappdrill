/**
 * A Playwright session with the wallet injected, the page's RPC routed to the
 * chain controller, and every artifact (video, trace, screenshots, live
 * frames, console, RPC log) collected under artifactsDir.
 */
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { newId, nowIso, type ConsoleEntry, type DrillEventSink, type DrillTarget, type RpcLogEntry, type WalletProfileId } from "@dappdrill/core";
import type { ChainController, DrillSession, WalletPolicy } from "../types.js";
import { Wallet } from "../wallet/controller.js";
import { BINDING_NAME, walletInitScript, type BridgeRequest, type InjectConfig } from "../wallet/inject.js";
import { toHex } from "../chain/rpc.js";
import { RpcRouter } from "./rpc-route.js";

export interface SessionOptions {
  artifactsDir: string;
  sink: DrillEventSink;
  headless?: boolean;
  /** Record a video (default true). */
  video?: boolean;
  /** Record a Playwright trace (default true). */
  trace?: boolean;
  /** Wallet the page sees as window.ethereum. Defaults to the target's first wallet. */
  wallet?: WalletProfileId;
  /** Also announce a second wallet through EIP-6963 (the "two wallets installed" case). */
  twoWallets?: boolean;
  /** Chain the wallet starts on. Defaults to the first configured chain. */
  startChainId?: number;
  policy?: Partial<WalletPolicy>;
  /** Used in artifact file names. Generated when missing. */
  runId?: string;
  /** Live-view frame interval (default 1500ms); 0 disables. */
  frameIntervalMs?: number;
  log?: (message: string) => void;
}

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const VIEWPORT = { width: 1280, height: 800 };
const FRAMES_KEPT = 6;
const BUSY_WINDOW_MS = 6_000;

export interface EngineSession extends DrillSession {
  readonly wallet: Wallet;
  readonly id: string;
  /** Count of pointerdown events seen in the page; ties sign requests to clicks. */
  clickSeq(): number;
  /** Mark the session busy so live frames keep flowing (replay calls it per step). */
  touch(): void;
}

export async function createSession(target: DrillTarget, chains: ChainController, opts: SessionOptions): Promise<EngineSession> {
  const id = opts.runId ?? newId("ses");
  const log = opts.log ?? (() => {});
  const dirs = {
    videos: path.join(opts.artifactsDir, "videos"),
    traces: path.join(opts.artifactsDir, "traces"),
    screenshots: path.join(opts.artifactsDir, "screenshots"),
    frames: path.join(opts.artifactsDir, "frames"),
  };
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));

  const profile = opts.wallet ?? target.wallets[0] ?? "metamask";
  const configs = chains.configs();
  if (configs.length === 0) throw new Error("createSession needs at least one chain");
  const startChainId = opts.startChainId ?? configs[0]!.id;

  const wallet = new Wallet({
    profile,
    chains,
    accounts: target.accounts,
    liveKey: target.liveKey,
    startChainId,
    policy: opts.policy,
    log,
  });
  await wallet.fundOnForks();

  const browser = await chromium.launch({ headless: opts.headless ?? true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    userAgent: UA,
    locale: "en-US",
    recordVideo: opts.video === false ? undefined : { dir: dirs.videos, size: VIEWPORT },
    ignoreHTTPSErrors: true,
  });
  if (opts.trace !== false) await context.tracing.start({ screenshots: true, snapshots: true });

  const session = new Session(id, target, chains, wallet, browser, context, opts, dirs, log);
  await session.init(profile, opts.twoWallets ? otherWallet(profile) : undefined, startChainId);
  return session;
}

class Session implements EngineSession {
  readonly console: ConsoleEntry[] = [];
  readonly rpc: RpcLogEntry[] = [];
  readonly artifactsDir: string;
  readonly emit: DrillEventSink;
  page!: Page;

  private clicks = 0;
  private lastClicked?: string;
  private lastActivity = Date.now();
  private frameTimer?: NodeJS.Timeout;
  private framing = false;
  private frameFiles: string[] = [];
  private closed = false;
  private readonly router: RpcRouter;

  constructor(
    readonly id: string,
    readonly target: DrillTarget,
    readonly chains: ChainController,
    readonly wallet: Wallet,
    private readonly browser: Browser,
    readonly context: BrowserContext,
    private readonly opts: SessionOptions,
    private readonly dirs: { videos: string; traces: string; screenshots: string; frames: string },
    private readonly log: (m: string) => void,
  ) {
    this.artifactsDir = opts.artifactsDir;
    this.emit = opts.sink;
    this.router = new RpcRouter({
      chains,
      onLog: (e) => this.rpc.push(e),
      onActivity: () => this.touch(),
    });
  }

  async init(profile: WalletProfileId, second: WalletProfileId | undefined, startChainId: number): Promise<void> {
    const { context, wallet } = this;
    wallet.onRequest((request) => {
      this.touch();
      void this.emit({ type: "wallet-request", request });
    });
    wallet.setEmitter(async (event, args) => {
      await Promise.all(
        context.pages().map((p) =>
          p.evaluate(([e, a]) => (window as any).__dappdrill?.emit(e, a), [event, args] as const).catch(() => {}),
        ),
      );
    });

    // Binding first, then the init script that uses it.
    await context.exposeBinding(BINDING_NAME, async (source, req: BridgeRequest) => {
      this.touch();
      if (req.method === "__click") {
        this.clicks++;
        const label = Array.isArray(req.params) ? req.params[0] : undefined;
        this.lastClicked = typeof label === "string" && label ? label : undefined;
        return { result: null };
      }
      return wallet.handle(req, { pageUrl: source.page.url(), buttonLabel: this.lastClicked, clickSeq: this.clicks });
    });
    // With two wallets installed the later one (the second) takes over window.ethereum, like real extensions do;
    // the dApp must use the EIP-6963 provider the user picked to reach the first.
    const wallets = second
      ? [{ id: second, uuid: crypto.randomUUID() }, { id: profile, uuid: crypto.randomUUID() }]
      : [{ id: profile, uuid: crypto.randomUUID() }];
    const cfg: InjectConfig = {
      wallets,
      chainId: toHex(startChainId),
      accounts: [],
      binding: BINDING_NAME,
    };
    await context.addInitScript({ content: walletInitScript(cfg) });
    await this.router.install(context);

    context.on("page", (p) => this.watchPage(p));
    this.page = await context.newPage();

    const interval = this.opts.frameIntervalMs ?? 1500;
    if (interval > 0) this.frameTimer = setInterval(() => void this.captureFrame(), interval);
  }

  private watchPage(page: Page): void {
    page.on("console", (msg) => {
      const type = msg.type();
      const level: ConsoleEntry["level"] = type === "error" ? "error" : type === "warning" ? "warn" : type === "info" ? "info" : "log";
      this.console.push({ level, text: msg.text().slice(0, 2000), at: nowIso() });
      this.touch();
    });
    page.on("pageerror", (err) => {
      this.console.push({ level: "pageerror", text: `${err.name}: ${err.message}`.slice(0, 2000), at: nowIso() });
      this.touch();
    });
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame()) this.touch();
    });
  }

  clickSeq(): number {
    return this.clicks;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  lastClickedLabel(): string | undefined {
    return this.lastClicked;
  }

  async screenshot(name: string): Promise<string> {
    const file = `${this.id}-${name.replace(/[^\w.-]+/g, "_")}.png`;
    const abs = path.join(this.dirs.screenshots, file);
    await this.page.screenshot({ path: abs, fullPage: false, timeout: 10_000 }).catch((e) => this.log(`screenshot ${name} failed: ${e.message}`));
    return path.relative(this.artifactsDir, abs);
  }

  private async captureFrame(): Promise<void> {
    if (this.framing || this.closed || this.page.isClosed()) return;
    if (Date.now() - this.lastActivity > BUSY_WINDOW_MS) return;
    this.framing = true;
    try {
      const file = path.join(this.dirs.frames, `${this.id}-${Date.now()}.jpg`);
      await this.page.screenshot({ path: file, type: "jpeg", quality: 55, timeout: 5_000 });
      this.frameFiles.push(file);
      while (this.frameFiles.length > FRAMES_KEPT) await rm(this.frameFiles.shift()!, { force: true });
      await this.emit({ type: "frame", path: path.relative(this.artifactsDir, file), url: this.page.url(), at: nowIso() });
    } catch {
      /* page mid-navigation or closed */
    } finally {
      this.framing = false;
    }
  }

  async close(): Promise<{ video?: string; trace?: string }> {
    if (this.closed) return {};
    this.closed = true;
    if (this.frameTimer) clearInterval(this.frameTimer);
    await this.wallet.closeAll();

    let trace: string | undefined;
    if (this.opts.trace !== false) {
      const abs = path.join(this.dirs.traces, `${this.id}.zip`);
      await this.context.tracing.stop({ path: abs }).catch((e) => this.log(`trace save failed: ${e.message}`));
      trace = path.relative(this.artifactsDir, abs);
    }

    const videoHandle = this.opts.video === false ? null : this.page.video();
    await this.context.close().catch(() => {});
    let video: string | undefined;
    if (videoHandle) {
      try {
        const tmp = await videoHandle.path();
        const abs = path.join(this.dirs.videos, `${this.id}.webm`);
        await rename(tmp, abs);
        video = path.relative(this.artifactsDir, abs);
      } catch (e) {
        this.log(`video save failed: ${(e as Error).message}`);
      }
    }
    await this.browser.close().catch(() => {});
    await pruneFrames(this.dirs.frames, this.id);
    return { video, trace };
  }
}

async function pruneFrames(dir: string, id: string): Promise<void> {
  try {
    const files = (await readdir(dir)).filter((f) => f.startsWith(`${id}-`)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 1))) await rm(path.join(dir, f), { force: true });
  } catch {
    /* nothing to prune */
  }
}

function otherWallet(profile: WalletProfileId): WalletProfileId {
  return profile === "metamask" ? "rabby" : "metamask";
}
