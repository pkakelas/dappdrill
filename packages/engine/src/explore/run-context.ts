/** What every stage of a pass shares. */
import { type AppMap, type AppSetup, type Blocked, type DrillEvent, type DrillEventSink, type ExploreCosts, type ExploreSuggestion, type SigningReview, type Step, type TestStep } from "@dappdrill/core";
import { openEnv, roundUsd, type Env } from "../pipeline/env.js";
import type { Prepared, SetupRunner } from "../pipeline/setup.js";
import { Board } from "./board.js";
import type { WalletToken } from "./funding.js";
import type { Found } from "./look.js";

/** A test the app already has. */
export interface KnownTest {
  id: string;
  name: string;
  goal: string;
}

/** A bug an earlier pass confirmed, so it isn't filed again. */
export interface KnownBug {
  id: string;
  name: string;
  summary: string;
}

export interface ExploreOptions {
  artifactsDir: string;
  /** The most minutes explorers get. A pass ends sooner when nothing new turns up. */
  budgetMinutes: number;
  hints?: string;
  /** The app's saved setup; it wins over what the look proposes. */
  setup?: AppSetup;
  tests?: KnownTest[];
  bugs?: KnownBug[];
  baselines?: Record<string, SigningReview>;
  /** Browsers at once (default 5). One when a chain is live. */
  slots?: number;
  headless?: boolean;
  /** What an earlier look found. With it the pass skips the look and starts from this. */
  found?: Found;
  /** Explore only these features, by name. The rest keep their suggested tests untried. */
  only?: string[];
  /** Stop once this stage is done. */
  until?: "look" | "setup";
}

export interface ExploreHooks {
  /** What the look learned: the app's map, and a setup when the app had none. */
  onMap?(map: AppMap, setup?: AppSetup): Promise<void>;
  /** The setup's steps, and its reset steps when it has them, with the actions that worked. */
  onSetupSteps?(steps: TestStep[], reset?: TestStep[]): Promise<void>;
  /** What the look put in the test wallet, as soon as it is there: a test saved later in the pass needs the same in its own runs. */
  onTokens?(tokens: WalletToken[]): Promise<void>;
  /** A test to save: proved, or a draft with its reason. */
  onTest?(suggestion: ExploreSuggestion): Promise<void>;
}

type Stage = "look" | "setup" | "explore" | "prove" | "confirm";

export class ExploreRun {
  readonly board: Board;
  blocked?: Blocked;
  /** What the look found, as it found it. */
  found?: Found;
  map?: AppMap;
  /** What a browser does first: the app's setup, or connecting the wallet. */
  entry!: AppSetup;
  /** The app's real setup when it has one: what saved tests run after. */
  setup?: AppSetup;
  /** The setup runner on the base env, for when explorers share it. */
  baseRunner?: SetupRunner;
  /** What the setup check prepared, when forks of their own can start from it too: a setup that sent no transaction. */
  ready?: Prepared;
  /** Forks can be had per explorer; a live chain can't be split. */
  readonly isolated: boolean;
  readonly slots: number;
  /** Explorers running now. */
  exploring = 0;
  /** What an explorer did on the path it handed over as a test, by suggestion id. */
  readonly recorded = new Map<string, Step[]>();
  private readonly jobs: (() => Promise<void>)[] = [];
  private working = 0;
  private idle: (() => void)[] = [];
  private reviews: Promise<void> = Promise.resolve();
  /** Spend of the envs that have closed, and of the base env's earlier stages. */
  private readonly closed: ExploreCosts = { stage: {}, model: {} };
  private readonly open = new Map<Env, Stage>();
  private baseStage: Stage = "look";
  private baseSeen = 0;

  constructor(
    readonly base: Env,
    readonly opts: ExploreOptions,
    readonly hooks: ExploreHooks,
    sink: DrillEventSink,
    readonly signal?: AbortSignal,
  ) {
    this.isolated = base.chains.configs().every((c) => c.mode === "fork");
    this.slots = this.isolated ? Math.max(1, opts.slots ?? 5) : 1;
    this.board = new Board(async (e: DrillEvent) => {
      await sink(e);
      await sink({ type: "cost", usd: this.costUsd() });
    });
  }

  costUsd(): number {
    return roundUsd(Object.values(this.costs().stage).reduce((a, b) => a + b, 0));
  }

  /** What the base env spends from now on counts towards `stage`. */
  stage(stage: Stage): void {
    bump(this.closed.stage, this.baseStage, this.base.costUsd() - this.baseSeen);
    this.baseSeen = this.base.costUsd();
    this.baseStage = stage;
  }

  costs(): ExploreCosts {
    const out = structuredClone(this.closed);
    bump(out.stage, this.baseStage, this.base.costUsd() - this.baseSeen);
    for (const [model, usd] of Object.entries(this.base.costs())) bump(out.model, model, usd);
    for (const [env, stage] of this.open) add(out, stage, env);
    for (const part of [out.stage, out.model]) for (const k of Object.keys(part)) part[k] = roundUsd(part[k]!);
    return out;
  }

  /** Runs `fn` on chains of its own, or on the shared ones when a chain is live. */
  async withEnv<T>(stage: Stage, fn: (env: Env) => Promise<T>): Promise<T> {
    if (!this.isolated) {
      this.stage(stage);
      return fn(this.base);
    }
    const env = await openEnv(this.base.target, (e) => (e.type === "log" && e.level !== "info" ? this.base.sink(e) : undefined), { headless: this.base.headless });
    this.open.set(env, stage);
    try {
      return await fn(env);
    } finally {
      this.open.delete(env);
      add(this.closed, stage, env);
      await env.close();
    }
  }

  /**
   * Browser work that comes up while explorers run: proving a test, reproducing a bug. Explorers
   * leave one browser free for it, and it takes the rest as they finish.
   */
  work(job: () => Promise<void>): void {
    this.jobs.push(job);
    this.pump();
  }

  pump(): void {
    // A stopped pass starts nothing new.
    if (this.signal?.aborted) this.jobs.length = 0;
    const room = Math.max(this.isolated ? 1 : 0, this.slots - this.exploring);
    while (this.working < room && this.jobs.length) {
      const job = this.jobs.shift()!;
      this.working++;
      void job()
        .catch((e) => this.base.log(`A job stopped: ${e instanceof Error ? e.message : e}`, "warn"))
        .finally(() => {
          this.working--;
          this.pump();
          if (!this.busy()) for (const done of this.idle.splice(0)) done();
        });
    }
  }

  private busy(): boolean {
    return this.working > 0 || this.jobs.length > 0;
  }

  /** One bug review after another, so each sees what the ones before it decided. */
  review(fn: () => Promise<void>): void {
    this.reviews = this.reviews.then(fn).catch((e) => this.base.log(`A review stopped: ${e instanceof Error ? e.message : e}`, "warn"));
  }

  /** Resolves when no review or job is left, including the ones they started. */
  async settled(): Promise<void> {
    for (;;) {
      const reviews = this.reviews;
      await reviews;
      if (this.busy()) await new Promise<void>((done) => this.idle.push(done));
      if (reviews === this.reviews && !this.busy()) return;
    }
  }
}

function bump(into: Record<string, number>, key: string, usd: number): void {
  into[key] = (into[key] ?? 0) + usd;
}

function add(into: ExploreCosts, stage: Stage, env: Env): void {
  bump(into.stage, stage, env.costUsd());
  for (const [model, usd] of Object.entries(env.costs())) bump(into.model, model, usd);
}
