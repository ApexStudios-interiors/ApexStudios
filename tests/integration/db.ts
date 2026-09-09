import postgres from "postgres";

/** One connection per file; vitest.integration.mts disables file parallelism. */
export function connect() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  return postgres(url, { max: 2, prepare: false, onnotice: () => {} });
}

/** Fixed seed ids, so tests reference rows by id rather than by position. */
export const SEED = {
  org: "00000000-0000-4000-8000-0000000000a0",
  project: "00000000-0000-4000-8000-0000000000c1",
  ownerProfile: "00000000-0000-4000-8000-0000000000d1",
  adminProfile: "00000000-0000-4000-8000-0000000000d2",
  siteProfile: "00000000-0000-4000-8000-0000000000d5",
  clientProfile: "00000000-0000-4000-8000-0000000000d6",
  poolPackage: "00000000-0000-4000-8000-0000000000e1",
  phaseWaterproofing: "00000000-0000-4000-8000-0000000000f1",
  phaseTiling: "00000000-0000-4000-8000-0000000000f2",
  cementItem: "00000000-0000-4000-8000-000000000601",
  billPaid: "00000000-0000-4000-8000-000000000401",
} as const;
