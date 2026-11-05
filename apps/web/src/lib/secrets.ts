const PRIVATE_KEY = /[0-9a-fA-F]{64}/;

/** Free text is stored unencrypted and reaches the model, so a private key must never sit in it. */
export function looksLikeKey(text: string): boolean {
  return PRIVATE_KEY.test(text);
}
