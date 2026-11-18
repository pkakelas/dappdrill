/**
 * Transaction simulation: an eth_call from the sender, on the chain as it is now. It says whether
 * the transaction would revert, and why. What it would move isn't measured.
 */
import type { Address } from "viem";
import type { ChainController } from "../types.js";
import { withTimeout } from "./http.js";
import type { Call } from "./request.js";

export interface Simulation {
  status: "ok" | "reverted" | "unavailable";
  /** Why it would revert, or why the chain couldn't be asked. */
  revertReason?: string;
}

export interface SimulateInput {
  chains: ChainController;
  chainId: number;
  from: Address;
  calls: Call[];
}

export async function simulate(input: SimulateInput): Promise<Simulation> {
  const unavailable = (why: string): Simulation => ({ status: "unavailable", revertReason: why });
  if (!input.chains.has(input.chainId)) return unavailable(`Chain ${input.chainId} is not available in this session`);
  try {
    return await withTimeout(call(input), 30_000, unavailable("Simulation timed out"));
  } catch (e) {
    return unavailable(`Simulation failed: ${(e as Error).message}`);
  }
}

async function call({ chains, chainId, from, calls }: SimulateInput): Promise<Simulation> {
  const client = chains.client(chainId);
  for (const [i, c] of calls.entries()) {
    try {
      await client.call({ account: from, to: c.to, data: c.data, value: c.value });
    } catch (e) {
      if (i === 0) return { status: "reverted", revertReason: revertReason(e) };
      // A later call of a batch builds on the ones before it (an approval, then the deposit), which an eth_call can't have sent.
      return { status: "unavailable", revertReason: `Call ${i + 1} of ${calls.length} builds on the calls before it, which can't be tried without sending them` };
    }
  }
  return { status: "ok" };
}

function revertReason(e: unknown): string {
  const err = e as { shortMessage?: string; details?: string; message?: string; data?: { message?: string } };
  const text = err.details ?? err.data?.message ?? err.shortMessage ?? err.message ?? String(e);
  return text.replace(/\s+/g, " ").slice(0, 200);
}
