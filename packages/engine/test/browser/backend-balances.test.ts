import { describe, expect, it } from "vitest";
import { balanceAsk, withBalance } from "../../src/browser/backend-balances.js";

const wallet = "0xc5F3a3f17550D2bc697569f0D2Ef1494e3b5Bd6F";
const other = "0x00000000000000000000000000000000000000aa";
const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const q = (o: object) => `https://app.example/api/swap/token-balance?q=${encodeURIComponent(JSON.stringify(o))}`;

describe("balanceAsk", () => {
  it("reads a token and a chain named in the query", () => {
    expect(balanceAsk(q({ address: wallet, chainId: "ethereum", decimals: 6, isNative: false, tokenAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" }), null, [wallet])).toEqual({ holder: wallet, token: usdc, chainId: 1 });
    expect(balanceAsk(q({ address: wallet, chainId: "base", isNative: true }), null, [wallet])).toEqual({ holder: wallet, token: undefined, chainId: 8453 });
  });

  it("reads a chain id, a body, and the placeholder for the chain's own coin", () => {
    expect(balanceAsk(`https://api.example/v1/balance/${wallet}?chainId=42161`, null, [wallet])).toMatchObject({ chainId: 42161, token: undefined });
    expect(balanceAsk("https://api.example/balance", JSON.stringify({ owner: wallet.toLowerCase(), token: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", chain: "eip155:10" }), [wallet])).toMatchObject({ chainId: 10, token: undefined });
    expect(balanceAsk(`https://api.example/balance/${wallet}`, null, [wallet])).toEqual({ holder: wallet, token: undefined, chainId: undefined });
  });

  it("leaves alone what isn't about one balance of ours", () => {
    expect(balanceAsk(`https://api.example/balance/${other}`, null, [wallet])).toBeUndefined();
    expect(balanceAsk(`https://api.example/quote?user=${wallet}&from=${usdc}&to=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, null, [wallet])).toBeUndefined();
    expect(balanceAsk(`https://api.example/balance/${wallet}?from=ethereum&to=base`, null, [wallet])).toBeUndefined();
    // A transaction hash is not an address.
    expect(balanceAsk(`https://api.example/tx/0x${"ab".repeat(32)}?user=${wallet}`, null, [wallet])).toMatchObject({ token: undefined });
  });
});

describe("withBalance", () => {
  const hundred = 100_000_000n;

  it("puts the fork's balance where the real one was, in the form it came in", () => {
    expect(withBalance({ wei: "0", decimals: 6 }, 0n, hundred, 6, true)).toEqual({ wei: "100000000", decimals: 6 });
    expect(withBalance({ data: { balance: "0x0" } }, 0n, hundred, 6, false)).toEqual({ data: { balance: "0x5f5e100" } });
    expect(withBalance({ balance: "0.0", symbol: "USDC" }, 0n, hundred, 6, false)).toEqual({ balance: "100", symbol: "USDC" });
    expect(withBalance({ balance: 2.5 }, 2_500_000n, hundred, 6, false)).toEqual({ balance: 100 });
    expect(withBalance([{ balance: "7" }], 7n, hundred, 6, false)).toEqual([{ balance: "100000000" }]);
  });

  it("keeps fields that only look like it", () => {
    expect(withBalance({ wei: "0", allowance: "0", usdValue: 0, chainId: 0 }, 0n, hundred, 6, true)).toEqual({ wei: "100000000", allowance: "0", usdValue: 0, chainId: 0 });
    expect(withBalance({ amount: "0", points: 0 }, 0n, hundred, 6, false)).toBeUndefined();
  });

  it("changes nothing when the answer isn't the real balance", () => {
    expect(withBalance({ wei: "5", decimals: 6 }, 0n, hundred, 6, true)).toBeUndefined();
    expect(withBalance({ error: "not found" }, 0n, hundred, 6, true)).toBeUndefined();
  });
});
