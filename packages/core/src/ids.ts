const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Short, URL-safe random id with a readable prefix: "test_8k2j…". */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Stable short hash for fingerprints (FNV-1a, 64-bit, hex). */
export function fingerprint(...parts: (string | number | undefined)[]): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of parts.map((p) => String(p ?? "")).join("|")) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
