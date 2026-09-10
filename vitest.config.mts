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
      // docs/code-standards.md §9: billing is 100% branch. The gate is wired
      // now, before Build 09 writes the code, so it cannot be argued down later.
      thresholds: {
        "features/billing/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
        "lib/money/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
