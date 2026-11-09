import { describe, expect, it } from "vitest";
import { tickerOf } from "../../src/explore/prices.js";

describe("tickerOf", () => {
  it("reads a pair against the dollar as its asset", () => {
    expect(tickerOf("ETH-USD")).toBe("ETH");
    expect(tickerOf("BTC/USDT")).toBe("BTC");
    expect(tickerOf(" $eth ")).toBe("ETH");
    expect(tickerOf("SOL USD")).toBe("SOL");
  });

  it("keeps an asset whose own name ends in USD", () => {
    for (const name of ["crvUSD", "sUSD", "PYUSD", "GUSD", "LUSD", "USDT", "USD"]) expect(tickerOf(name)).toBe(name.toUpperCase());
  });

  it("has no ticker for what isn't one", () => {
    expect(tickerOf("Wrapped Staked Ether Token")).toBeUndefined();
    expect(tickerOf("")).toBeUndefined();
  });
});
