import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Real, RLS-scoped supabase-js sessions for the seeded roles (AGENTS.md
 * database rule 8), signed in ONCE per account per run.
 *
 * Every suite used to keep its own copy of signedInAs() and do a fresh
 * password sign-in on every call — 33 per run, against Supabase's limit of
 * about 30 sign-ins per 5 minutes per IP. One run sat at the limit and two
 * close together went over it, which failed CI with "Request rate limit
 * reached" at random. The access token is cached in a temp file because
 * Vitest loads each test file in its own module graph, so an in-memory cache
 * would still sign in once per file.
 *
 * The returned client sends that access token as-is (`accessToken` option):
 * it never refreshes or signs out, so one suite cannot end another's session.
 */
export const PASSWORD = "apex-dev-only";

function config(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  return { url, key };
}

/** No session at all — the `anon` role. */
export function anonClient(): SupabaseClient {
  const { url, key } = config();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Cached = { accessToken: string; expiresAt: number };
const CACHE_DIR = join(tmpdir(), "apex-integration-sessions");
// Reuse a token only while it has at least this long left, so it cannot
// expire part-way through a slow suite.
const MIN_REMAINING_MS = 10 * 60_000;

async function accessTokenFor(email: string): Promise<string> {
  const { url } = config();
  const file = join(CACHE_DIR, `${new URL(url).hostname}-${encodeURIComponent(email)}.json`);
  try {
    const cached = JSON.parse(readFileSync(file, "utf8")) as Cached;
    if (cached.expiresAt * 1000 - Date.now() > MIN_REMAINING_MS) return cached.accessToken;
  } catch {
    // No usable cache entry — sign in below.
  }

  const { data, error } = await anonClient().auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session)
    throw new Error(`Could not sign in as ${email}: ${error?.message ?? "no session"}`);
  mkdirSync(CACHE_DIR, { recursive: true });
  const entry: Cached = { accessToken: data.session.access_token, expiresAt: data.session.expires_at ?? 0 };
  writeFileSync(file, JSON.stringify(entry), { mode: 0o600 });
  return entry.accessToken;
}

export async function signedInAs(email: string): Promise<SupabaseClient> {
  const token = await accessTokenFor(email);
  const { url, key } = config();
  return createClient(url, key, { accessToken: async () => token });
}
