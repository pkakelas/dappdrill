/** Request fixtures: calldata and typed data as a dApp would send them to the wallet. */
import { encodeFunctionData, maxUint160, maxUint256, type Address, type Hex } from "viem";
import type { WalletRequest } from "@dappdrill/core";
import { BUILTIN_ABI, PERMIT2_ADDRESS } from "../../src/signing/builtin.js";

export const WALLET: Address = "0x1111111111111111111111111111111111111111";
export const EOA_SPENDER: Address = "0x2222222222222222222222222222222222222222";
export const VAULT: Address = "0x3333333333333333333333333333333333333333"; // verified contract in the fakes
export const NEW_ROUTER: Address = "0x4444444444444444444444444444444444444444"; // unverified, 3 days old
export const USDC_MAINNET: Address = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
export const WETH_MAINNET: Address = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export const UNIVERSAL_ROUTER: Address = "0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD";
export const NFT: Address = "0x5555555555555555555555555555555555555555";
export { PERMIT2_ADDRESS };

let seq = 0;
export function txRequest(to: Address, data: Hex, opts: { value?: bigint; from?: Address; chainId?: number } = {}): WalletRequest {
  return {
    id: `req_${++seq}`,
    method: "eth_sendTransaction",
    params: [{ from: opts.from ?? WALLET, to, data, value: opts.value !== undefined ? `0x${opts.value.toString(16)}` : undefined }],
    chainId: opts.chainId ?? 1,
    from: opts.from ?? WALLET,
    kind: "sign",
    at: new Date().toISOString(),
    outcome: "pending",
  };
}

export function signRequest(method: string, params: unknown[], chainId = 1): WalletRequest {
  return { id: `req_${++seq}`, method, params, chainId, from: WALLET, kind: "sign", at: new Date().toISOString(), outcome: "pending" };
}

export const approveData = (spender: Address, amount: bigint) => encodeFunctionData({ abi: BUILTIN_ABI, functionName: "approve", args: [spender, amount] });
export const increaseAllowanceData = (spender: Address, amount: bigint) => encodeFunctionData({ abi: BUILTIN_ABI, functionName: "increaseAllowance", args: [spender, amount] });
export const setApprovalForAllData = (operator: Address, approved: boolean) => encodeFunctionData({ abi: BUILTIN_ABI, functionName: "setApprovalForAll", args: [operator, approved] });
export const permit2ApproveData = (token: Address, spender: Address, amount: bigint, expiration: number) =>
  encodeFunctionData({ abi: BUILTIN_ABI, functionName: "approve", args: [token, spender, amount, expiration] });
export const multicallData = (calls: Hex[]) => encodeFunctionData({ abi: BUILTIN_ABI, functionName: "multicall", args: [calls] });
export const aggregate3Data = (calls: { target: Address; callData: Hex }[]) =>
  encodeFunctionData({ abi: BUILTIN_ABI, functionName: "aggregate3", args: [calls.map((c) => ({ ...c, allowFailure: false }))] });
export const depositData = () => encodeFunctionData({ abi: BUILTIN_ABI, functionName: "deposit" });
export const transferData = (to: Address, amount: bigint) => encodeFunctionData({ abi: BUILTIN_ABI, functionName: "transfer", args: [to, amount] });
export const JUNK_DATA: Hex = "0xdeadbeef0000000000000000000000000000000000000000000000000000000000000001";

export const UNLIMITED = maxUint256;
export const PERMIT2_UNLIMITED = maxUint160;
export const usdc = (n: number) => BigInt(Math.round(n * 1e6));

export function siweMessage(domain: string, address = WALLET, uri = `https://${domain}`): string {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Sign in to Harbor Vault.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    "Chain ID: 1",
    "Nonce: 8f1c2b9e7d",
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

export function eip2612Permit(token: Address, spender: Address, value: bigint, deadline: bigint, chainId = 1) {
  return {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
    },
    primaryType: "Permit",
    domain: { name: "USD Coin", version: "2", chainId, verifyingContract: token },
    message: { owner: WALLET, spender, value: value.toString(), nonce: "0", deadline: deadline.toString() },
  };
}

export function daiPermit(token: Address, spender: Address, allowed: boolean) {
  return {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
      Permit: [{ name: "holder", type: "address" }, { name: "spender", type: "address" }, { name: "nonce", type: "uint256" }, { name: "expiry", type: "uint256" }, { name: "allowed", type: "bool" }],
    },
    primaryType: "Permit",
    domain: { name: "Dai Stablecoin", version: "1", chainId: 1, verifyingContract: token },
    message: { holder: WALLET, spender, nonce: 1, expiry: 0, allowed },
  };
}

const PERMIT2_DOMAIN_TYPES = [{ name: "name", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }];

export function permit2Single(token: Address, spender: Address, amount: bigint, expiration: number, chainId = 1) {
  return {
    types: {
      EIP712Domain: PERMIT2_DOMAIN_TYPES,
      PermitSingle: [{ name: "details", type: "PermitDetails" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
      PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
    },
    primaryType: "PermitSingle",
    domain: { name: "Permit2", chainId, verifyingContract: PERMIT2_ADDRESS },
    message: { details: { token, amount: amount.toString(), expiration, nonce: 0 }, spender, sigDeadline: expiration + 1800 },
  };
}

export function permit2Batch(details: { token: Address; amount: bigint }[], spender: Address) {
  return {
    types: {
      EIP712Domain: PERMIT2_DOMAIN_TYPES,
      PermitBatch: [{ name: "details", type: "PermitDetails[]" }, { name: "spender", type: "address" }, { name: "sigDeadline", type: "uint256" }],
      PermitDetails: [{ name: "token", type: "address" }, { name: "amount", type: "uint160" }, { name: "expiration", type: "uint48" }, { name: "nonce", type: "uint48" }],
    },
    primaryType: "PermitBatch",
    domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2_ADDRESS },
    message: { details: details.map((d) => ({ token: d.token, amount: d.amount.toString(), expiration: 1_900_000_000, nonce: 0 })), spender, sigDeadline: 1_900_000_000 },
  };
}

export function permit2TransferFrom(token: Address, amount: bigint, spender: Address) {
  return {
    types: {
      EIP712Domain: PERMIT2_DOMAIN_TYPES,
      PermitTransferFrom: [{ name: "permitted", type: "TokenPermissions" }, { name: "spender", type: "address" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
      TokenPermissions: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    },
    primaryType: "PermitTransferFrom",
    domain: { name: "Permit2", chainId: 1, verifyingContract: PERMIT2_ADDRESS },
    message: { permitted: { token, amount: amount.toString() }, spender, nonce: 7, deadline: 1_900_000_000 },
  };
}

export function genericTypedData() {
  return {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
      Vote: [{ name: "proposal", type: "uint256" }, { name: "support", type: "bool" }, { name: "voter", type: "address" }],
    },
    primaryType: "Vote",
    domain: { name: "Harbor Governance", version: "1", chainId: 1 },
    message: { proposal: 42, support: true, voter: WALLET },
  };
}
