/**
 * EIP-712 typed data: flatten the message for display and recognise the
 * shapes that grant something — EIP-2612 / DAI permits, Permit2 permits and
 * transfers — plus Seaport orders.
 */
import type { Address } from "viem";
import type { DecodedArg } from "@dappdrill/core";
import { addr, toBigInt, type TypedData } from "./request.js";
import { stringify } from "./format.js";

export type TypedKind =
  | "eip2612"
  | "dai-permit"
  | "permit2-single"
  | "permit2-batch"
  | "permit2-transfer"
  | "permit2-witness-transfer"
  | "seaport"
  | "generic";

export interface TypedPermit {
  token: Address;
  spender: Address;
  amount: bigint;
  /** Seconds since epoch; undefined when the permit never expires. */
  deadline?: bigint;
  permit2: boolean;
  /** Permit2 transfers move tokens straight to the spender; permits only set an allowance. */
  transfer: boolean;
}

export interface DecodedTyped {
  kind: TypedKind;
  primaryType: string;
  domain: { name?: string; version?: string; chainId?: number; verifyingContract?: Address };
  owner?: Address;
  permits: TypedPermit[];
  args: DecodedArg[];
  seaport?: { offer: string[]; consideration: string[] };
}

type Msg = Record<string, unknown>;

export function decodeTypedData(td: TypedData): DecodedTyped {
  const m = td.message;
  const domain = {
    name: typeof td.domain.name === "string" ? td.domain.name : undefined,
    version: typeof td.domain.version === "string" ? td.domain.version : undefined,
    chainId: td.domain.chainId !== undefined ? Number(toBigInt(td.domain.chainId)) : undefined,
    verifyingContract: addr(td.domain.verifyingContract),
  };
  const base = { primaryType: td.primaryType, domain, args: flatten(td, m), permits: [] as TypedPermit[] };
  const fields = new Set((td.types[td.primaryType] ?? []).map((f) => f.name));
  const has = (...names: string[]) => names.every((n) => fields.has(n));
  const vc = domain.verifyingContract;

  if (td.primaryType === "Permit" && has("owner", "spender", "value", "deadline") && vc) {
    const spender = addr(m.spender);
    if (spender) {
      return { ...base, kind: "eip2612", owner: addr(m.owner), permits: [{ token: vc, spender, amount: toBigInt(m.value), deadline: toBigInt(m.deadline), permit2: false, transfer: false }] };
    }
  }
  if (td.primaryType === "Permit" && has("holder", "spender", "allowed", "expiry") && vc) {
    const spender = addr(m.spender);
    if (spender) {
      const expiry = toBigInt(m.expiry);
      const allowed = m.allowed === true || m.allowed === "true" || m.allowed === 1;
      return {
        ...base,
        kind: "dai-permit",
        owner: addr(m.holder),
        permits: [{ token: vc, spender, amount: allowed ? (1n << 256n) - 1n : 0n, deadline: expiry === 0n ? undefined : expiry, permit2: false, transfer: false }],
      };
    }
  }
  if (td.primaryType === "PermitSingle" && has("details", "spender")) {
    const p = permit2Detail(m.details as Msg, addr(m.spender));
    return { ...base, kind: "permit2-single", permits: p ? [p] : [] };
  }
  if (td.primaryType === "PermitBatch" && has("details", "spender")) {
    const spender = addr(m.spender);
    const details = Array.isArray(m.details) ? (m.details as Msg[]) : [];
    return { ...base, kind: "permit2-batch", permits: details.map((d) => permit2Detail(d, spender)).filter((p): p is TypedPermit => !!p) };
  }
  if ((td.primaryType === "PermitTransferFrom" || td.primaryType === "PermitWitnessTransferFrom" || td.primaryType === "PermitBatchTransferFrom") && has("permitted", "spender")) {
    const spender = addr(m.spender);
    const deadline = toBigInt(m.deadline);
    const permitted = Array.isArray(m.permitted) ? (m.permitted as Msg[]) : [m.permitted as Msg];
    const permits: TypedPermit[] = [];
    for (const p of permitted) {
      const token = addr(p?.token);
      if (token && spender) permits.push({ token, spender, amount: toBigInt(p.amount), deadline, permit2: true, transfer: true });
    }
    return { ...base, kind: fields.has("witness") ? "permit2-witness-transfer" : "permit2-transfer", permits };
  }
  if (td.primaryType === "OrderComponents" && has("offerer", "offer", "consideration")) {
    const items = (v: unknown) => (Array.isArray(v) ? (v as Msg[]).map(seaportItem) : []);
    return { ...base, kind: "seaport", owner: addr(m.offerer), seaport: { offer: items(m.offer), consideration: items(m.consideration) } };
  }
  return { ...base, kind: "generic", owner: addr(m.owner) ?? addr(m.from) };
}

function permit2Detail(d: Msg | undefined, spender: Address | undefined): TypedPermit | undefined {
  const token = addr(d?.token);
  if (!d || !token || !spender) return undefined;
  const expiration = toBigInt(d.expiration);
  return { token, spender, amount: toBigInt(d.amount), deadline: expiration === 0n ? undefined : expiration, permit2: true, transfer: false };
}

const SEAPORT_ITEM_TYPES = ["ETH", "ERC20", "ERC721", "ERC1155", "ERC721 (criteria)", "ERC1155 (criteria)"];

function seaportItem(item: Msg): string {
  const type = SEAPORT_ITEM_TYPES[Number(toBigInt(item.itemType))] ?? "item";
  const token = addr(item.token);
  const amount = toBigInt(item.startAmount);
  const id = toBigInt(item.identifierOrCriteria);
  const to = addr(item.recipient);
  const what = type === "ETH" ? `${amount} wei` : type.startsWith("ERC721") ? `${type} #${id} of ${token ?? "?"}` : `${amount} of ${type} ${token ?? "?"}`;
  return to ? `${what} → ${to}` : what;
}

/** Flatten nested message fields to "a.b.c" args with their EIP-712 types. */
function flatten(td: TypedData, message: Msg): DecodedArg[] {
  const out: DecodedArg[] = [];
  const walk = (typeName: string, value: unknown, prefix: string) => {
    const isArray = typeName.endsWith("]");
    const baseType = isArray ? typeName.slice(0, typeName.indexOf("[")) : typeName;
    const fields = td.types[baseType];
    if (isArray && Array.isArray(value)) {
      value.forEach((v, i) => walk(baseType, v, `${prefix}[${i}]`));
      return;
    }
    if (fields && value && typeof value === "object") {
      for (const f of fields) walk(f.type, (value as Msg)[f.name], prefix ? `${prefix}.${f.name}` : f.name);
      return;
    }
    out.push({ name: prefix, type: typeName, value: stringify(value) });
  };
  walk(td.primaryType, message, "");
  return out.slice(0, 60);
}
