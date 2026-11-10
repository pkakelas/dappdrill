/** What an address holds of the chain's native coin, in wei, or undefined when the RPC doesn't answer in time. */
export async function readBalance(url: string, address: string): Promise<bigint | undefined> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }),
      signal: AbortSignal.timeout(4000),
    });
    const { result } = (await res.json()) as { result?: unknown };
    return typeof result === "string" && /^0x[0-9a-f]+$/i.test(result) ? BigInt(result) : undefined;
  } catch {
    return undefined;
  }
}

/** The chain ID an RPC reports, or undefined if it doesn't answer like one. */
export async function readChainId(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(5000),
    });
    const { result } = (await res.json()) as { result?: unknown };
    return typeof result === "string" && /^0x[0-9a-f]+$/i.test(result) ? Number(result) : undefined;
  } catch {
    return undefined;
  }
}
