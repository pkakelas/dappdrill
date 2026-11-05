/** What every stage of an exploration shares. */
import type { AppMap, AppSetup, Blocked, CheckReplay, DrillEvent, DrillEventSink, ExploreCandidate, SigningReview, TestStep } from "@dappdrill/core";
import { openEnv, type Env } from "../pipeline/env.js";
import type { SetupRunner } from "../pipeline/setup.js";
import { Board } from "./board.js";

/** A test the app already has. */
export interface KnownTest {
  id: string;
  name: string;
  goal: string;
  flow: string;
}

export interface ExploreOptions {
  artifactsDir: string;
  /** Minutes of exploring; proving and confirming come after. */
  budgetMinutes: number;
  hints?: string;
  map?: AppMap;
  setup?: AppSetup;
  tests?: KnownTest[];
  baselines?: Record<string, SigningReview>;
  /** Explorers at once (default 3). One when a chain is live. */
  slots?: number;
  headless?: boolean;
}

export interface ExploreHooks {
  onSetupSteps?(steps: TestStep[]): Promise<void>;
  /** A test to save: proved, or a draft with its reason. */
  onTest?(candidate: ExploreCandidate): Promise<void>;
}

export class ExploreRun {
  readonly board: Board;
  /** How to repeat each check, by check id. */
  readonly replays = new Map<string, CheckReplay>();
  /** Failed checks a bug report already covers. */
  readonly filed = new Set<string>();
  blocked?: Blocked;
  /** What a browser does first: the app's setup, or connecting the wallet. */
  entry!: AppSetup;
  /** The setup runner on the base env, for when explorers share it. */
  baseRunner?: SetupRunner;
  /** Forks can be had per explorer; a live chain can't be split. */
  readonly isolated: boolean;
  readonly slots: number;
  private spent = 0;
  private readonly open = new Set<Env>();

  constructor(
    readonly base: Env,
    readonly opts: ExploreOptions,
    readonly hooks: ExploreHooks,
    sink: DrillEventSink,
    readonly signal?: AbortSignal,
  ) {
    this.isolated = base.chains.configs().every((c) => c.mode === "fork");
    this.slots = this.isolated ? Math.max(1, opts.slots ?? 3) : 1;
    this.board = new Board(async (e: DrillEvent) => {
      await sink(e);
      await sink({ type: "cost", usd: Math.round(this.costUsd() * 1000) / 1000 });
    });
  }

  costUsd(): number {
    return this.base.costUsd() + this.spent + [...this.open].reduce((sum, e) => sum + e.costUsd(), 0);
  }

  /** Runs `fn` on chains of its own, or on the shared ones when a chain is live. */
  async withEnv<T>(fn: (env: Env) => Promise<T>): Promise<T> {
    if (!this.isolated) return fn(this.base);
    const env = await openEnv(this.base.target, (e) => (e.type === "log" && e.level !== "info" ? this.base.sink(e) : undefined), { headless: this.base.headless });
    this.open.add(env);
    try {
      return await fn(env);
    } finally {
      this.open.delete(env);
      this.spent += env.costUsd();
      await env.close();
    }
  }
}
