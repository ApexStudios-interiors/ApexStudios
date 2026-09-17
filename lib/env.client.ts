import { z } from "zod";

/**
 * Anything in this file is public. Treat it as printed on a billboard.
 *
 * NEXT_PUBLIC_* values are inlined into the client bundle at build time. The
 * Supabase anon key belongs here and is safe by design: RLS is what protects
 * the data, not the secrecy of the key (`docs/architecture.md` §5.3).
 *
 * The service_role key, R2 credentials and CRON_SECRET must never appear here.
 */
const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // The deployed origin. It was the magic-link callback target until D51
  // removed the magic link; nothing in the app reads it now (e2e/global-setup
  // still uses it as a fallback base URL). Left required on purpose: every
  // environment already sets it, and loosening the schema is a separate change
  // from removing its last caller.
  NEXT_PUBLIC_SITE_URL: z.url(),
});

export type ClientEnv = z.infer<typeof clientSchema>;

// Next.js replaces these at build time only when referenced statically, so
// they cannot be read from a dynamic key.
const raw = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
};

function parseClientEnv(): ClientEnv {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    return raw as unknown as ClientEnv;
  }
  const result = clientSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid public environment. Fix .env.local (see .env.example):\n${problems}`);
  }
  return result.data;
}

export const clientEnv: ClientEnv = parseClientEnv();
