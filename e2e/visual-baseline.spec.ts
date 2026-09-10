import { expect, test } from "@playwright/test";

/**
 * The visual-parity baseline for the prototype, tag `proto-v1`.
 *
 * Build 04 onward replaces AppContext with real data feature by feature. These
 * images are what "no pixel changed" is measured against, and they cannot be
 * recaptured once the prototype is gone. See docs/build/01-foundations.md §3.17.
 *
 * Role lives in React state with no persistence, so a full navigation resets it
 * to admin. Every case therefore navigates first and switches role second.
 */

type Role = "admin" | "site" | "client";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  site: "Site Supervisor",
  client: "Client",
};

const PROJECT = "bhel";
const MODULE = "pool";

/** Routes, and which roles may reach each one. */
const ROUTES: { name: string; path: string; roles: Role[] }[] = [
  { name: "all-projects", path: "/", roles: ["admin", "site", "client"] },
  { name: "inventory-all", path: "/inventory", roles: ["admin", "site"] },
  { name: "users", path: "/users", roles: ["admin"] },
  { name: "project-dashboard", path: `/projects/${PROJECT}`, roles: ["admin", "site", "client"] },
  { name: "project-packages", path: `/projects/${PROJECT}/packages`, roles: ["admin", "site", "client"] },
  {
    name: "package-detail",
    path: `/projects/${PROJECT}/packages/${MODULE}`,
    roles: ["admin", "site", "client"],
  },
  { name: "project-schedule", path: `/projects/${PROJECT}/schedule`, roles: ["admin", "site", "client"] },
  { name: "project-updates", path: `/projects/${PROJECT}/updates`, roles: ["admin", "site", "client"] },
  { name: "project-inventory", path: `/projects/${PROJECT}/inventory`, roles: ["admin", "site"] },
  { name: "project-stock", path: `/projects/${PROJECT}/stock`, roles: ["admin", "site"] },
  { name: "project-approvals", path: `/projects/${PROJECT}/approvals`, roles: ["admin", "site", "client"] },
  { name: "project-billing", path: `/projects/${PROJECT}/billing`, roles: ["admin", "client"] },
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

        if (role !== "admin") {
          await page
            .getByRole("button", { name: /Switch role/i })
            .or(page.locator("aside > div:last-child > button"))
            .last()
            .click();
          await page.getByRole("button", { name: ROLE_LABEL[role], exact: true }).click();
        }

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
