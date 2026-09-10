import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Integration tests against a real Postgres.
 *
 * Separate from `pnpm test` on purpose. These have a hard prerequisite —
 * SUPABASE_DB_URL pointing at a migrated, seeded, non-production database — and
 * a suite that silently skips when its prerequisite is missing is a suite that
 * reports green while testing nothing. Here the absence is a hard error instead.
 */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    // Concurrency tests race deliberately; running files in parallel against one
    // database makes their results meaningless.
    fileParallelism: false,
    testTimeout: 30_000,
    setupFiles: ["tests/integration/setup.ts"],
  },
});
