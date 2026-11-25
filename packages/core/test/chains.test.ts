import { describe, expect, it } from "vitest";
import { withFoundChains, type ChainConfig } from "../src/chains.js";

const eth: ChainConfig = { id: 1, name: "Ethereum", rpcUrl: "https://eth.example", fallback: true };
const sepolia: ChainConfig = { id: 11155111, name: "Sepolia", rpcUrl: "https://sepolia.example", fromApp: true };
const base: ChainConfig = { id: 84532, name: "Base Sepolia", rpcUrl: "https://base.example", fromApp: true };

describe("withFoundChains", () => {
  it("adds a chain the app was seen to use after the ones kept", () => {
    expect(withFoundChains([sepolia], [sepolia, base])).toEqual([sepolia, base]);
  });

  it("says nothing is new when every chain is kept already, whatever its RPC", () => {
    expect(withFoundChains([sepolia, base], [{ ...base, rpcUrl: "https://other.example" }])).toBeUndefined();
    expect(withFoundChains([sepolia], [])).toBeUndefined();
  });

  it("drops the Ethereum fallback once a chain of the app's own is known, and never adds it", () => {
    expect(withFoundChains([eth], [eth, sepolia])).toEqual([sepolia]);
    expect(withFoundChains([], [eth])).toBeUndefined();
    expect(withFoundChains([sepolia], [eth])).toBeUndefined();
  });
});
