/** personal_sign / eth_sign: text, and Sign-In With Ethereum (EIP-4361) detection. */
import type { Address } from "viem";

export interface Siwe {
  domain: string;
  address?: string;
  statement?: string;
  uri?: string;
  chainId?: number;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
}

const SIWE_HEADER = /^(?<domain>[^\n]+?) wants you to sign in with your Ethereum account:\n(?<address>0x[0-9a-fA-F]{40})\n/;

export function parseSiwe(text: string): Siwe | undefined {
  const header = SIWE_HEADER.exec(text);
  if (!header?.groups) return undefined;
  const field = (name: string) => new RegExp(`^${name}: (.+)$`, "m").exec(text)?.[1]?.trim();
  const afterHeader = text.slice(header[0].length);
  const statement = afterHeader.split(/\n(?=URI: )/)[0]?.trim() || undefined;
  const chainId = field("Chain ID");
  return {
    domain: header.groups.domain!.trim(),
    address: header.groups.address,
    statement: statement && !statement.startsWith("URI:") ? statement : undefined,
    uri: field("URI"),
    chainId: chainId && /^\d+$/.test(chainId) ? Number(chainId) : undefined,
    nonce: field("Nonce"),
    issuedAt: field("Issued At"),
    expirationTime: field("Expiration Time"),
  };
}

/** True when the SIWE domain (host[:port]) is the page's host or a parent of it. */
export function siweDomainMatches(siweDomain: string, pageHost: string | undefined): boolean | undefined {
  if (!pageHost) return undefined;
  const d = siweDomain.toLowerCase().replace(/:\d+$/, "");
  const h = pageHost.toLowerCase();
  return d === h || h.endsWith(`.${d}`);
}

export interface DecodedMessage {
  text?: string;
  isHash: boolean;
  siwe?: Siwe;
  /** The SIWE address is not the account that's signing. */
  siweAddressMismatch?: boolean;
}

export function decodeMessage(input: { raw: string; text?: string; isHash: boolean; from?: Address }): DecodedMessage {
  const siwe = input.text ? parseSiwe(input.text) : undefined;
  const mismatch = siwe?.address && input.from ? siwe.address.toLowerCase() !== input.from.toLowerCase() : undefined;
  return { text: input.text, isHash: input.isHash, siwe, siweAddressMismatch: mismatch };
}
