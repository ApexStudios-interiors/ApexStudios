import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["{lib,features,db,app,components,context,hooks,tests}/**/*.{test,spec}.{ts,tsx}"],
    // Playwright owns e2e/. Running it under Vitest would start two runners.
    // tests/integration/ needs a real database and has its own config, so that
    // its absence is a hard error there rather than noise here.
    exclude: ["node_modules/**", "e2e/**", ".next/**", "docs/**", "tests/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["lib/**", "features/**"],
      exclude: ["**/__tests__/**", "**/*.d.ts"],
      // docs/code-standards.md §9 / build/09-billing.md §5: "100% branch on
      // features/billing/service.ts and every billing RPC path" — the
      // service is the pure decimal.js preview engine unit-tested here; the
      // RPC paths are tested against the live database in
      // tests/integration/billing.test.ts, the same split every other
      // feature's actions.ts/queries.ts already follows (thin guard-parse-
      // delegate wrappers with no branch logic of their own to gate here).
      // Scoped to the one file, not the whole features/billing/** directory
      // — a wider glob would demand unit coverage on Supabase-calling code
      // this project deliberately tests through real sessions instead.
      thresholds: {
        "features/billing/service.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        // The bill PDF's revision-keyed job key and file name — pure, and on
        // the billing side of the same 100%-branch bar for the same reason:
        // getting either wrong means a client certifies against a superseded
        // document.
        "features/billing/pdf.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "lib/money/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
