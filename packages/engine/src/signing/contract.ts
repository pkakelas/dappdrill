/**
 * Per-review contract facts: is it a contract, is the source verified, is it
 * a proxy (and is the implementation verified), how old is it, is it a token.
 * Results are memoised per address so the decoder and the checks share them.
 */
import {
  getAddress,
  keccak256,
  stringToHex,
  toHex,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { etherscan, etherscanCreation, sourcify, type SourceInfo } from "./abi-sources.js";
import { BUILTIN_ABI, knownContract } from "./builtin.js";
import { withTimeout, type Http } from "./http.js";

export interface ContractInfo {
  address: Address;
  code: "contract" | "eoa" | "unknown";
  /** undefined = could not find out (lookups failed). */
  verified?: boolean;
  verifiedVia?: "sourcify" | "explorer";
  name?: string;
  abi?: Abi;
  abiSource?: "sourcify" | "explorer" | "builtin";
  /** Built-in label for contracts we recognise by address. */
  known?: string;
  proxy?: {
    kind: "eip1967" | "beacon" | "eip1822" | "oz-legacy" | "eip1167";
    implementation: Address;
    implementationVerified?: boolean;
    implementationName?: string;
  };
}

export interface ContractAge {
  days: number;
  blockNumber: bigint;
  /** rpc = found by probing eth_getCode over blocks (on-chain); explorer = indexer data (unverified). */
  source: "rpc" | "explorer";
}

export interface TokenInfo {
  address: Address;
  standard: "erc20" | "erc721" | "erc1155" | "none";
  symbol?: string;
  name?: string;
  decimals?: number;
  totalSupply?: bigint;
}

export interface ContractsDeps {
  http: Http;
  chainId: number;
  /** Fork (or live) client. Undefined when the chain isn't available. */
  client?: PublicClient;
  /** Upstream RPC of the fork, used for the creation-block search. Falls back to `client`. */
  upstream?: PublicClient;
  etherscanApiKey?: string;
  /** Block the fork is pinned at; ages are relative to it. */
  headBlock?: bigint;
  lookupTimeoutMs?: number;
}

const slot = (label: string): Hex => toHex(BigInt(keccak256(stringToHex(label))) - 1n, { size: 32 });
const SLOT_EIP1967_IMPL = slot("eip1967.proxy.implementation");
const SLOT_EIP1967_BEACON = slot("eip1967.proxy.beacon");
const SLOT_EIP1822 = keccak256(stringToHex("PROXIABLE"));
const SLOT_OZ_LEGACY = keccak256(stringToHex("org.zeppelinos.proxy.implementation"));
const EIP1167_RE = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/i;
/** Anvil / Hardhat / Ganache defaults: no explorer, no Sourcify, no history worth dating. */
export const isLocalChain = (chainId: number): boolean => chainId === 31337 || chainId === 1337;
const IFACE_ERC721 = "0x80ac58cd";
const IFACE_ERC1155 = "0xd9b67a26";
const NEVER = Number.POSITIVE_INFINITY;

export class Contracts {
  private readonly infos = new Map<string, Promise<ContractInfo>>();
  private readonly ages = new Map<string, Promise<ContractAge | undefined>>();
  private readonly tokens = new Map<string, Promise<TokenInfo | undefined>>();
  private readonly timeout: number;

  constructor(private readonly deps: ContractsDeps) {
    this.timeout = deps.lookupTimeoutMs ?? 10_000;
  }

  info(address: Address): Promise<ContractInfo> {
    const key = address.toLowerCase();
    let p = this.infos.get(key);
    if (!p) {
      p = withTimeout(this.lookupInfo(getAddress(address)), this.timeout + 2000, { address: getAddress(address), code: "unknown" });
      this.infos.set(key, p);
    }
    return p;
  }

  age(address: Address): Promise<ContractAge | undefined> {
    const key = address.toLowerCase();
    let p = this.ages.get(key);
    if (!p) {
      p = withTimeout(this.lookupAge(getAddress(address)).catch(() => undefined), this.timeout + 2000, undefined);
      this.ages.set(key, p);
    }
    return p;
  }

  token(address: Address): Promise<TokenInfo | undefined> {
    const key = address.toLowerCase();
    let p = this.tokens.get(key);
    if (!p) {
      p = withTimeout(this.lookupToken(getAddress(address)).catch(() => undefined), this.timeout, undefined);
      this.tokens.set(key, p);
    }
    return p;
  }

  private async lookupInfo(address: Address): Promise<ContractInfo> {
    const { chainId } = this.deps;
    const known = knownContract(chainId, address);
    const info: ContractInfo = { address, code: "unknown", known: known?.name, name: known?.name };

    const bytecode = await this.getCode(address);
    if (bytecode !== undefined) info.code = bytecode && bytecode !== "0x" ? "contract" : "eoa";
    if (info.code === "eoa") return info;

    const [source, proxy] = await Promise.all([this.source(address), this.detectProxy(address, bytecode)]);
    if (source) {
      info.verified = source.verified;
      info.verifiedVia = source.via;
      // A curated label ("Permit2 (Uniswap)") beats the compiled contract name.
      info.name = known?.name ?? source.name;
      if (source.abi) {
        info.abi = source.abi;
        info.abiSource = source.via;
      }
    }
    if (proxy) {
      const impl = await this.source(proxy.implementation);
      info.proxy = { ...proxy, implementationVerified: impl?.verified, implementationName: impl?.name };
      // A proxy's own ABI is rarely what the call targets: prefer the implementation's.
      if (impl?.abi) {
        info.abi = impl.abi;
        info.abiSource = impl.via;
      }
    } else if (source?.implementation) {
      const impl = await this.source(source.implementation);
      info.proxy = { kind: "eip1967", implementation: source.implementation, implementationVerified: impl?.verified, implementationName: impl?.name };
      if (impl?.abi) {
        info.abi = impl.abi;
        info.abiSource = impl.via;
      }
    }
    if (!info.abi && known) {
      info.abi = BUILTIN_ABI;
      info.abiSource = "builtin";
    }
    return info;
  }

  private async source(address: Address): Promise<SourceInfo | undefined> {
    const { http, chainId, etherscanApiKey } = this.deps;
    // Nothing is verified on a throwaway dev chain; report "couldn't check" rather than "unverified".
    if (isLocalChain(chainId)) return undefined;
    const viaSourcify = await sourcify(http, chainId, address);
    if (viaSourcify?.verified) return viaSourcify;
    if (etherscanApiKey) {
      const viaExplorer = await etherscan(http, chainId, address, etherscanApiKey);
      if (viaExplorer?.verified) return viaExplorer;
      return viaExplorer ?? viaSourcify;
    }
    return viaSourcify;
  }

  private async detectProxy(address: Address, bytecode: Hex | undefined): Promise<ContractInfo["proxy"] | undefined> {
    const minimal = bytecode && EIP1167_RE.exec(bytecode);
    if (minimal) return { kind: "eip1167", implementation: getAddress(`0x${minimal[1]}`) };
    const client = this.deps.client;
    if (!client) return undefined;
    const read = async (s: Hex): Promise<Address | undefined> => {
      try {
        const v = await client.getStorageAt({ address, slot: s });
        if (!v || BigInt(v) === 0n) return undefined;
        return getAddress(`0x${v.slice(-40)}`);
      } catch {
        return undefined;
      }
    };
    const [impl, beacon, uups, legacy] = await Promise.all([read(SLOT_EIP1967_IMPL), read(SLOT_EIP1967_BEACON), read(SLOT_EIP1822), read(SLOT_OZ_LEGACY)]);
    if (impl) return { kind: "eip1967", implementation: impl };
    if (beacon) {
      try {
        const implementation = await client.readContract({ address: beacon, abi: BUILTIN_ABI, functionName: "implementation" });
        return { kind: "beacon", implementation: implementation as Address };
      } catch {
        return undefined;
      }
    }
    if (uups) return { kind: "eip1822", implementation: uups };
    if (legacy) return { kind: "oz-legacy", implementation: legacy };
    return undefined;
  }

  private async getCode(address: Address): Promise<Hex | undefined> {
    try {
      return (await this.deps.client?.getCode({ address })) ?? (this.deps.client ? "0x" : undefined);
    } catch {
      return undefined;
    }
  }

  private async lookupAge(address: Address): Promise<ContractAge | undefined> {
    const { http, chainId, client, etherscanApiKey } = this.deps;
    // Everything on a dev chain was deployed minutes ago; "new contract" would mean nothing.
    if (!client || isLocalChain(chainId)) return undefined;
    const head = this.deps.headBlock ?? (await client.getBlockNumber());

    let creation: { blockNumber: bigint; source: ContractAge["source"] } | undefined;
    if (etherscanApiKey) {
      const r = await etherscanCreation(http, chainId, address, etherscanApiKey);
      if (r?.blockNumber !== undefined) creation = { blockNumber: r.blockNumber, source: "explorer" };
    }
    if (!creation) {
      // Creation blocks never change, so cache them for good (except on throwaway local chains).
      const found = await http.remember<string>(`creation:${chainId}:${address.toLowerCase()}`, isLocalChain(chainId) ? 0 : NEVER, async () => {
        const block = await this.findCreationBlock(address, head);
        return block === undefined ? undefined : block.toString();
      });
      if (found) creation = { blockNumber: BigInt(found), source: "rpc" };
    }
    if (!creation) return undefined;

    const [created, latest] = await Promise.all([client.getBlock({ blockNumber: creation.blockNumber }), client.getBlock({ blockNumber: head })]);
    const days = Number(latest.timestamp - created.timestamp) / 86_400;
    return { days: Math.max(0, days), blockNumber: creation.blockNumber, source: creation.source };
  }

  /** Binary search over eth_getCode for the first block with code. ~log2(head) RPC calls. */
  private async findCreationBlock(address: Address, head: bigint): Promise<bigint | undefined> {
    const rpc = this.deps.upstream ?? this.deps.client!;
    const hasCode = async (blockNumber: bigint) => {
      const code = await rpc.getCode({ address, blockNumber });
      return !!code && code !== "0x";
    };
    if (!(await hasCode(head))) return undefined;
    let lo = 0n;
    let hi = head;
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      if (await hasCode(mid)) hi = mid;
      else lo = mid + 1n;
    }
    return lo;
  }

  /** The underlying token of an ERC-4626 vault (`asset()`), if the contract has one. */
  async underlying(vault: Address): Promise<TokenInfo | undefined> {
    const client = this.deps.client;
    if (!client) return undefined;
    try {
      const asset = (await client.readContract({ address: vault, abi: BUILTIN_ABI, functionName: "asset" })) as Address;
      return await this.token(asset);
    } catch {
      return undefined;
    }
  }

  private async lookupToken(address: Address): Promise<TokenInfo | undefined> {
    const client = this.deps.client;
    const known = knownContract(this.deps.chainId, address);
    if (!client) return known?.symbol ? { address, standard: "erc20", symbol: known.symbol, decimals: known.decimals, name: known.name } : undefined;

    const read = async <T>(functionName: string, args: unknown[] = []): Promise<T | undefined> => {
      try {
        return (await client.readContract({ address, abi: BUILTIN_ABI, functionName, args })) as T;
      } catch {
        return undefined;
      }
    };
    const [decimals, symbol, name] = await Promise.all([read<number>("decimals"), read<string>("symbol"), read<string>("name")]);
    if (decimals !== undefined) {
      const totalSupply = await read<bigint>("totalSupply");
      return { address, standard: "erc20", symbol: symbol ?? known?.symbol, name: name ?? known?.name, decimals: Number(decimals), totalSupply };
    }
    const [is721, is1155] = await Promise.all([read<boolean>("supportsInterface", [IFACE_ERC721]), read<boolean>("supportsInterface", [IFACE_ERC1155])]);
    if (is721) return { address, standard: "erc721", symbol, name };
    if (is1155) return { address, standard: "erc1155", symbol, name };
    return { address, standard: "none", symbol, name };
  }
}
