/**
 * Pure. No next/* imports — testable against a plain connection or no
 * connection at all (HLD §4.3, code-standards §1).
 */

/**
 * Every seeded staff account is @beapex.in (supabase/seed.sql: hello@,
 * suresh@, prakash@, meena@, ravi@), and it is the address the owner already
 * signs in with. A username becomes `<username>@beapex.in`.
 */
export const USER_EMAIL_DOMAIN = "beapex.in";

export function emailForUsername(username: string): string {
  return `${username}@${USER_EMAIL_DOMAIN}`;
}

const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l, o
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
const SYMBOLS = "!@#$%^&*-_=+?";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/** supabase/config.toml sets minimum_password_length = 12; this clears it comfortably. */
export const GENERATED_PASSWORD_LENGTH = 20;

/** Fills a Uint32Array with cryptographically strong random values. */
export type RandomSource = (buffer: Uint32Array) => Uint32Array;

const webCrypto: RandomSource = (buffer) => globalThis.crypto.getRandomValues(buffer);

/** Unbiased integer in [0, n): rejection sampling, never `value % n` on its own. */
function randomIndex(n: number, random: RandomSource): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    const v = random(buf)[0] ?? 0;
    if (v < limit) return v % n;
  }
}

function pick(alphabet: string, random: RandomSource): string {
  return alphabet.charAt(randomIndex(alphabet.length, random));
}

/**
 * A strong one-time password: 20 characters from a 69-symbol alphabet (about
 * 122 bits), with at least one lower-case letter, upper-case letter, digit and
 * symbol so it passes any character-class policy GoTrue may be configured
 * with. Look-alike characters (0/O, 1/l/I) are left out because it is read off
 * a screen and handed to someone.
 */
export function generatePassword(random: RandomSource = webCrypto): string {
  const chars = [pick(LOWER, random), pick(UPPER, random), pick(DIGITS, random), pick(SYMBOLS, random)];
  while (chars.length < GENERATED_PASSWORD_LENGTH) chars.push(pick(ALL, random));

  // Fisher-Yates, so the guaranteed classes are not always in the first four places.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    const tmp = chars[i] ?? "";
    chars[i] = chars[j] ?? "";
    chars[j] = tmp;
  }
  return chars.join("");
}
