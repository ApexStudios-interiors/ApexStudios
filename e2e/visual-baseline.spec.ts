import { expect, test } from "@playwright/test";

/**
 * The visual-parity baseline for the prototype, tag `proto-v1`.
 *
 * Build 04 onward replaces AppContext with real data feature by feature. These
 * images are what "no pixel changed" is measured against, and they cannot be
 * recaptured once the prototype is gone. See docs/build/01-foundations.md §3.17.
 *
 * Each Playwright project (admin/site/client) now carries a REAL signed-in
 * storage state from e2e/global-setup.ts (build/03-auth-and-rbac.md) — no more
 * in-page role switching, because that UI no longer exists. AppContext's
 * `role` is locked to the real session for the run.
 */

type Role = "admin" | "site" | "client";

// Build 04 re-keyed every mock id to its real database UUID (lib/data.ts's own
// header comment explains why) — these two constants have to track that.
const PROJECT = "00000000-0000-4000-8000-0000000000c1"; // BHEL Nagnar Club House
const MODULE = "00000000-0000-4000-8000-0000000000e1"; // Swimming Pool

/** Routes, and which roles may reach each one. */
const ROUTES: { name: string; path: string; roles: Role[] }[] = [
  { name: "all-projects", path: "/", roles: ["admin", "site", "client"] },
  { name: "inventory-all", path: "/inventory", roles: ["admin", "site"] },
  { name: "users", path: "/users", roles: ["admin"] },
  { name: "project-dashboard", path: `/projects/${PROJECT}`, roles: ["admin", "site", "client"] },
  { name: "project-packages", path: `/projects/${PROJECT}/packages`, roles: ["admin", "site", "client"] },
  {
    // Build 04: /packages/:moduleId now redirects to its default tab
    // (02-lld.md §8.1) — the bare URL is no longer where this route settles.
    name: "package-detail",
    path: `/projects/${PROJECT}/packages/${MODULE}/budget`,
    roles: ["admin", "site", "client"],
  },
  { name: "project-schedule", path: `/projects/${PROJECT}/schedule`, roles: ["admin", "site", "client"] },
  {
    // build/05-schedule-and-progress.md §3.5 step 2: a new route, not present
    // in proto-v1 (the prototype's Schedule tab lived only at the project
    // level). No prior baseline exists for it — this run establishes one,
    // it does not compare against a frozen prototype image.
    name: "package-schedule",
    path: `/projects/${PROJECT}/packages/${MODULE}/schedule`,
    roles: ["admin", "site", "client"],
  },
  { name: "project-updates", path: `/projects/${PROJECT}/updates`, roles: ["admin", "site", "client"] },
  { name: "project-inventory", path: `/projects/${PROJECT}/inventory`, roles: ["admin", "site"] },
  { name: "project-stock", path: `/projects/${PROJECT}/stock`, roles: ["admin", "site"] },
  { name: "project-approvals", path: `/projects/${PROJECT}/approvals`, roles: ["admin", "site", "client"] },
  { name: "project-billing", path: `/projects/${PROJECT}/billing`, roles: ["admin", "client"] },
  {
    // build/09-billing.md — a new route, not present in proto-v1 (the
    // prototype's Billing tab lived only at the project level, same
    // reasoning as package-schedule above). No prior baseline exists for
    // it; this run establishes one, it does not compare against a frozen
    // prototype image.
    name: "package-billing",
    path: `/projects/${PROJECT}/packages/${MODULE}/billing`,
    roles: ["admin", "client"],
  },
];

const THEMES = ["light", "dark"] as const;

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme });

    for (const route of ROUTES) {
      test(`${route.name}`, async ({ page }, testInfo) => {
        const role = testInfo.project.name as Role;
        test.skip(!route.roles.includes(role), `${route.name} is not reachable as ${role}`);

        // Set the theme before first paint; app/layout.tsx reads it synchronously.
        await page.addInitScript((t) => {
          try {
            window.localStorage.setItem("theme", t);
          } catch {
            /* private mode — the prefers-color-scheme fallback applies */
          }
        }, theme);

        await page.goto(route.path);

        // The role-gate redirect in the project layout runs in an effect.
        await page.waitForLoadState("networkidle");
        await expect(page).toHaveURL(new RegExp(route.path.replace(/[/]/g, "\\/") + "$"));

        await expect(page).toHaveScreenshot(`${role}-${theme}-${route.name}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  });
}
