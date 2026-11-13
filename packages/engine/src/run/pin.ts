/** Fork state is pinned around each test so tests never see each other's transactions. */
import type { Env } from "./env.js";

/** Why the forks can't be trusted any more, once one couldn't be put back. */
const spoilt = new WeakMap<Env, string>();

/** Set once a fork of this env couldn't be put back: whatever runs next would start on what ran before. */
export const spoiledBy = (env: Env): string | undefined => spoilt.get(env);

/** Snapshot every fork; the returned function reverts to it (and resets forks the app added since). No-op on live chains. */
export async function pin(env: Env): Promise<() => Promise<void>> {
  const snaps: [number, string][] = [];
  for (const c of env.chains.configs()) if (c.mode === "fork") snaps.push([c.id, await env.chains.snapshot(c.id)]);
  return async () => {
    const failed: string[] = [];
    for (const [id, snap] of snaps) await env.chains.revert(id, snap).catch((e) => failed.push(`chain ${id}: ${(e as Error).message.split("\n")[0]}`));
    await env.resetAddedChains(snaps.map(([id]) => id)).catch((e) => failed.push(`added chains: ${(e as Error).message.split("\n")[0]}`));
    if (failed.length && !spoilt.has(env)) spoilt.set(env, `the test chain couldn't be put back after an earlier run (${failed.join("; ")})`);
  };
}
