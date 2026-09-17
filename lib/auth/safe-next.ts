/**
 * `?next=` comes from the URL, so it is attacker-controlled. Only same-origin
 * paths are followed; "//evil.com" and "/\evil.com" are protocol-relative
 * redirects in browsers and are refused too.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
