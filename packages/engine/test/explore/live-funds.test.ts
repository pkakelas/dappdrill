import { describe, expect, it } from "vitest";
import { liveFundsLine, liveFundsNeed } from "../../src/explore/run.js";

const pod = { id: 129302, name: "pod testnet" };

describe("liveFundsNeed", () => {
  it("asks for a funded account when a live chain has neither a key nor a way to get test funds", () => {
    expect(liveFundsNeed({}, [pod])).toEqual({ what: "live-funds", chainId: 129302, name: "pod testnet" });
    expect(liveFundsNeed({ funding: "  " }, [{ id: 129302 }])).toEqual({ what: "live-funds", chainId: 129302, name: "pod testnet" });
  });

  it("is content with either, and with no live chain at all", () => {
    expect(liveFundsNeed({ liveKey: "0xkey" }, [pod])).toBeUndefined();
    expect(liveFundsNeed({ funding: "The Faucet page mints 1,000 USDC." }, [pod])).toBeUndefined();
    expect(liveFundsNeed({}, [])).toBeUndefined();
  });

  it("says what to give, and that it is for real", () => {
    expect(liveFundsLine(liveFundsNeed({}, [pod])!)).toBe("pod testnet can't be forked, so tests run on it for real and need an account with test funds there. Add a private key with test tokens, or say how to get test funds, then explore again.");
  });
});
