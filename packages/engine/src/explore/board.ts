/**
 * The exploration's shared state. Explorers change it as they go; it reaches the sink at most
 * once a second, so a dozen explorers and their frames don't turn into a write each.
 */
import { ExploreState, nowIso, type DrillEventSink, type Explorer, type ExploreFeedLine, type ExplorePhase } from "@dappdrill/core";

const EMIT_EVERY_MS = 1000;
const FEED_KEPT = 80;

export class Board {
  readonly state: ExploreState = ExploreState.parse({});
  private timer?: NodeJS.Timeout;
  private last = 0;

  constructor(private readonly sink: DrillEventSink) {}

  change(fn: (state: ExploreState) => void): void {
    fn(this.state);
    if (this.timer) return;
    const wait = Math.max(0, this.last + EMIT_EVERY_MS - Date.now());
    this.timer = setTimeout(() => void this.emit(), wait);
  }

  phase(phase: ExplorePhase, line?: string): void {
    this.change((s) => (s.phase = phase));
    if (line) this.feed("note", line);
  }

  feed(kind: ExploreFeedLine["kind"], text: string, explorerId?: string): void {
    this.change((s) => {
      s.feed.push({ at: nowIso(), kind, text, explorerId });
      if (s.feed.length > FEED_KEPT) s.feed.splice(0, s.feed.length - FEED_KEPT);
    });
  }

  addExplorer(explorer: Explorer): void {
    this.change((s) => void s.explorers.push(explorer));
  }

  explorer(id: string, patch: Partial<Explorer>): void {
    this.change((s) => {
      const e = s.explorers.find((x) => x.id === id);
      if (e) Object.assign(e, patch);
    });
  }

  /** Sends the latest state now. */
  async flush(): Promise<void> {
    await this.emit();
  }

  private async emit(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.last = Date.now();
    await this.sink({ type: "explore", state: structuredClone(this.state) });
  }
}

/** Runs `fn` over `items`, at most `n` at a time, each worker keeping its slot number. */
export async function pool<T>(items: T[], n: number, fn: (item: T, slot: number) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, queue.length) }, async (_, slot) => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await fn(item, slot);
    }),
  );
}
