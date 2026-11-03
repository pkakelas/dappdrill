import { describe, expect, it } from "vitest";
import { concat, encodeAbiParameters, hashDomain, keccak256, recoverAddress, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { signTypedData } from "../../src/wallet/signer.js";

const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");

describe("signTypedData", () => {
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
