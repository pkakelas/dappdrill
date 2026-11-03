import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for secrets at rest (wallet keys, webhook URLs, bot tokens).
// Format: base64(iv[12] | tag[16] | ciphertext)

function key(): Buffer {
  const secret = process.env.DAPPDRILL_SECRET;
  if (!secret || secret.length < 16) throw new Error("DAPPDRILL_SECRET must be set (at least 16 chars)");
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

export function decrypt(sealed: string): string {
  const buf = Buffer.from(sealed, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString("utf8");
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
