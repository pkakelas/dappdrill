import { describe, expect, it } from "vitest";
import { concat, encodeAbiParameters, hashDomain, keccak256, recoverAddress, recoverTypedDataAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { errorLine } from "../../src/wallet/controller.js";
import { signTypedData, typedDataChainId } from "../../src/wallet/signer.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("signTypedData", () => {
  it("keeps a chainId sent as a string in the domain, like Lido's stETH permit", async () => {
    const domain = { name: "Liquid staked Ether 2.0", version: "2", verifyingContract: "0xae7ab96520de3a18e5e111b5eaab095312d7fe84" } as const;
    const types = { Permit: [{ name: "owner", type: "address" }, { name: "nonce", type: "uint256" }] };
    const message = { owner: account.address, nonce: "0" };
    const typed = { domain: { ...domain, chainId: "1" }, types, primaryType: "Permit", message };
    const signature = await signTypedData(account, [account.address, JSON.stringify(typed)], 1);
    const signer = await recoverTypedDataAddress({ domain: { ...domain, chainId: 1 }, types, primaryType: "Permit", message: { owner: account.address, nonce: 0n }, signature });
    expect(signer).toBe(account.address);
  });

  it("signs struct names viem rejects but MetaMask accepts, like Hyperliquid:AcceptTerms", async () => {
    const domainTypes = [
      { name: "name", type: "string" },
      { name: "version", type: "string" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
    ] as const;
    const domain = { name: "HyperliquidSignTransaction", version: "1", chainId: 421614, verifyingContract: "0x0000000000000000000000000000000000000000" } as const;
    const typed = {
      domain,
      types: {
        EIP712Domain: domainTypes,
        "Hyperliquid:AcceptTerms": [
          { name: "hyperliquidChain", type: "string" },
          { name: "time", type: "uint64" },
        ],
      },
      primaryType: "Hyperliquid:AcceptTerms",
      message: { hyperliquidChain: "Testnet", time: 1793707214435 },
    };
    const signature = await signTypedData(account, [account.address, JSON.stringify(typed)]);

    // The EIP-712 hash, built by hand from the spec.
    const typeHash = keccak256(toHex("Hyperliquid:AcceptTerms(string hyperliquidChain,uint64 time)"));
    const structHash = keccak256(
      encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }, { type: "uint64" }], [typeHash, keccak256(toHex("Testnet")), 1793707214435n]),
    );
    const hash = keccak256(concat(["0x1901", hashDomain({ domain: { ...domain, chainId: 421614n }, types: { EIP712Domain: domainTypes } }), structHash]));
    expect(await recoverAddress({ hash, signature })).toBe(account.address);
  });
});

describe("typedDataChainId", () => {
  const typed = (chainId: unknown) => ({ types: {}, primaryType: "X", domain: { name: "Pod", chainId }, message: {} });
  it("reads the domain chain from a JSON string or an object", () => {
    expect(typedDataChainId(["0xabc", JSON.stringify(typed(129302))])).toBe(129302);
    expect(typedDataChainId(["0xabc", typed("0x1f916")])).toBe(129302);
    expect(typedDataChainId(["0xabc", typed("129302")])).toBe(129302);
  });
  it("is undefined when the data names no usable chain", () => {
    expect(typedDataChainId(["0xabc", typed(undefined)])).toBeUndefined();
    expect(typedDataChainId(["0xabc", typed(0)])).toBeUndefined();
    expect(typedDataChainId(["0xabc", "{not json"])).toBeUndefined();
    expect(typedDataChainId([])).toBeUndefined();
  });
});

describe("errorLine", () => {
  it("keeps the node's reason from inside a wallet's wrapped error", () => {
    expect(errorLine({ code: -32603, message: "Internal JSON-RPC error.", data: { code: 3, message: "execution reverted: NothingToWithdraw()" } })).toBe("-32603 Internal JSON-RPC error: execution reverted: NothingToWithdraw()");
    expect(errorLine({ code: -32603, message: "Internal JSON-RPC error." })).toBe("-32603 Internal JSON-RPC error.");
    expect(errorLine({ code: 4001, message: "User rejected the request.", data: { message: "User rejected the request." } })).toBe("4001 User rejected the request.");
  });
});
