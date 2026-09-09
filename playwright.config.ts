import { defineConfig, devices } from "@playwright/test";

/**
 * Three projects, one per role. Roles are switched through the app's own role
 * picker until Build 03 replaces AppContext with real sessions; from then on
 * each project gets its own saved storage state.
 *
 * `docs/code-standards.md` §9: E2E covers the three role journeys.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/proto-v1/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "admin", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "site", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "client", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: "pnpm dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
});
