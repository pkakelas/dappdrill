// Debug only: open a local frontend in an engine session and print what the RPC router answers from the fork.
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DrillTarget } from "@dappdrill/core";
import { startChains } from "../src/chain/controller.js";
import { createSession } from "../src/browser/session.js";

const [url, chainId, rpcUrl] = [process.argv[2]!, Number(process.argv[3]), process.argv[4]!];
const chains = await startChains([{ id: chainId, rpcUrl, mode: "fork" }], { log: console.log });
const target = DrillTarget.parse({ url, chains: [{ id: chainId, rpcUrl }] });
const artifactsDir = await mkdtemp(path.join(os.tmpdir(), "rpc-probe-"));
const session = await createSession(target, chains, { artifactsDir, sink: () => {}, video: false, trace: false, frameIntervalMs: 0 });
const t0 = Date.now();
await session.page.goto(url).catch((e) => console.log("goto", e.message));
await session.page.waitForTimeout(40_000);
const rpc = session.rpc;
const by = new Map<string, number[]>();
for (const e of rpc) { const k = `${e.via} ${e.method}${e.error ? " ERR " + e.error.slice(0, 400) : ""}`; by.set(k, [...(by.get(k) ?? []), e.durationMs]); }
for (const [k, v] of [...by].sort((a, b) => b[1].length - a[1].length)) { v.sort((a, b) => a - b); console.log(String(v.length).padStart(5), k, "p50", v[v.length >> 1], "max", v.at(-1)); }
const slow = rpc.filter((e) => e.durationMs > 5000).slice(0, 5);
console.log("slow:", slow.map((e) => `${e.method} ${e.durationMs}ms @${Date.parse(e.at) - t0}`).join(", "));
await session.close(); await chains.close();
