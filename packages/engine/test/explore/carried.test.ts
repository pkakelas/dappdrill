import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import type { WalletRequest } from "@dappdrill/core";
import { carried } from "../../src/explore/carried.js";

const WALLET = "0xc5f3a3f17550d2bc697569f0d2ef1494e3b5bd6f";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const RECIPIENT = "0x1111111111111111111111111111111111111111";
const request = (method: string, params: unknown[]) => ({ id: "r", method, params, chainId: 1, kind: "sign", at: "", outcome: "approved" }) as WalletRequest;
const send = (data: string, value = "0x0") => request("eth_sendTransaction", [{ from: WALLET, to: "0x88c59c19d54afcb83594ab4b24f67907cff08102", data, value, gas: "0x5208", nonce: "0x7" }]);

/** A bridge deposit as app.axelar.network asked for it: a function we have no ABI for. */
const DEPOSIT = `0xb69eb664${[
  "38b2caf37cccf00b6fbc0feb1e534daf567950e4d48066d0e3669028fe5f83e6",
  "00000000000000000000000088c59c19d54afcb83594ab4b24f67907cff08102",
  "000000000000000000000000c5f3a3f17550d2bc697569f0d2ef1494e3b5bd6f",
  "000000000000000000000000db291ef29c66a0a5ba35eb521fe8d52d3ab5898c",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "000000000000000000000000000000000000000000000000002386f26fc10000",
  "43b48883ef7be0f98fe7f98fafb2187e42caab4063697b32816f95e09d69b3ec",
  "00000000000000000000000088c59c19d54afcb83594ab4b24f67907cff08102",
  "0000000000000000000000001111111111111111111111111111111111111111",
  "000000000000000000000000db291ef29c66a0a5ba35eb521fe8d52d3ab5898c",
  "000000000000000000000000833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0000000000000000000000000000000000000000000000000000000001534414",
  "0000000000000000000000000000000000000000000000000000000000000000",
  "e090b5b20361243f440a04e18b1eff5f63a87c01b12155df10183b2d6d0f606b",
  "000000000000000000000000000000000000000000000000000000006aee230f",
  "000000000000000000000000000000000000000000000000000000006aee2747",
  "0000000000000000000000000000000000000000000000000000000000000220",
  "0000000000000000000000000000000000000000000000000000000000000000",
].join("")}`;

describe("carried", () => {
  it("reads the recipient, the token and the amounts of a call it has no ABI for", () => {
    const has = carried(send(DEPOSIT, "0x2386f26fc10000"));
    expect(has.addresses).toEqual(expect.arrayContaining([RECIPIENT, USDC_BASE, WALLET]));
    expect(has.amounts).toEqual(expect.arrayContaining([10n ** 16n, 22_234_132n]));
    // Hashes and timestamps are numbers, never addresses.
    expect(has.addresses.every((a) => /^0x[0-9a-f]{40}$/.test(a))).toBe(true);
    expect(has.addresses).toHaveLength(5);
  });

  it("reads a call inside a call", () => {
    const router = parseAbi([
      "function multicall(bytes[] data)",
      "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)",
    ]);
    const swap = encodeFunctionData({ abi: router, functionName: "exactInputSingle", args: [{ tokenIn: WALLET, tokenOut: USDC_BASE, fee: 500, recipient: RECIPIENT, amountIn: 5_000_000n, amountOutMinimum: 4_975_000n, sqrtPriceLimitX96: 0n }] });
    const has = carried(send(encodeFunctionData({ abi: router, functionName: "multicall", args: [[swap]] })));
    expect(has.addresses).toEqual(expect.arrayContaining([USDC_BASE, RECIPIENT]));
    expect(has.amounts).toEqual(expect.arrayContaining([5_000_000n, 4_975_000n]));
  });

  it("reads typed data, as an object or as the JSON string wallets get", () => {
    const order = {
      primaryType: "Order",
      domain: { name: "Orders", chainId: 8453, verifyingContract: "0x000000000022D473030F116dDEE9F6B43aC78BA3" },
      message: { sellToken: USDC_BASE, receiver: `0x${"0".repeat(24)}${RECIPIENT.slice(2)}`, sellAmount: "5000000", buyAmount: 1500000000000000, nonce: 99, validTo: 1793991439 },
    };
    for (const typed of [order, JSON.stringify(order)]) {
      const has = carried(request("eth_signTypedData_v4", [WALLET, typed]));
      expect(has.addresses).toEqual(expect.arrayContaining([USDC_BASE, RECIPIENT, "0x000000000022d473030f116ddee9f6b43ac78ba3"]));
      expect(has.amounts).toEqual(expect.arrayContaining([5_000_000n, 1_500_000_000_000_000n]));
      // The chain and the nonce aren't amounts of anything.
      expect(has.amounts).not.toContain(8453n);
      expect(has.amounts).not.toContain(99n);
    }
  });

  it("leaves gas out, and finds nothing in a message", () => {
    expect(carried(send("0x")).amounts).toEqual([0n]);
    expect(carried(request("personal_sign", ["Send 5000000 to 0x1111111111111111111111111111111111111111", WALLET]))).toEqual({ addresses: [], amounts: [] });
  });
});
