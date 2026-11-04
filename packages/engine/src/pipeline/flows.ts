/** Fork state is pinned around each test so tests never see each other's transactions. */
import type { Env } from "./env.js";

/** Snapshot every fork; the returned function reverts to it (and resets forks the app added since). No-op on live chains. */
export async function pin(env: Env): Promise<() => Promise<void>> {
  const snaps: [number, string][] = [];
  for (const c of env.chains.configs()) if (c.mode === "fork") snaps.push([c.id, await env.chains.snapshot(c.id)]);
  return async () => {
    for (const [id, snap] of snaps) await env.chains.revert(id, snap).catch(() => {});
    await env.resetAddedChains(snaps.map(([id]) => id)).catch(() => {});
  };
}
