/** Only same-site paths are allowed as post-login destinations. */
export function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}
