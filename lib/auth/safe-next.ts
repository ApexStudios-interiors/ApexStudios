/**
 * `?next=` comes from the URL, so it is attacker-controlled. Only same-origin
 * paths are followed.
 *
 * A prefix check alone is not enough (APX-27): browsers strip tab, newline and
 * carriage return from a URL before parsing it and treat "\" as "/", so
 * "/\t/evil.com" — `?next=/%09/evil.com` once decoded — became the
 * protocol-relative "//evil.com". So any control character or backslash is
 * refused outright, and what is left is resolved against a fixed origin and
 * must still be on it. The returned value is the re-serialised path, never
 * the raw input.
 */
const BASE_ORIGIN = "https://apex.invalid";

// Control characters (U+0000–U+001F, U+007F) and the backslash.
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || UNSAFE.test(next)) return "/";

  let url: URL;
  try {
    url = new URL(next, BASE_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== BASE_ORIGIN) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
