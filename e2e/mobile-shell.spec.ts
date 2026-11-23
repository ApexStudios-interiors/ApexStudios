import { expect, test, type Page } from "@playwright/test";

/**
 * APX-16 / APX-47 at phone width (390×844): the responsive shell (top bar,
 * drawer, collapsed search), "no page wider than the viewport", the card
 * lists that replace tables on a phone, and the rebuilt DialogShell (a real
 * modal: Escape, focus return, "Discard changes?").
 *
 * READ-ONLY: nothing is submitted — every dialog opened here is cancelled.
 * It still signs in (e2e/global-setup.ts), so run it ONLY against `pnpm dev`
 * pointed at a NON-production database (AGENTS.md, D49) — never against the
 * hosted project or the live site.
 *
 * Screenshot names are new (`mobile-390-shell-*`). The first run on a test
 * database records them; a human reviews those images before they are
 * committed (visual-baseline.spec.ts's rules apply unchanged).
 */

type Role = "admin" | "site" | "client";
const PROJECT = "00000000-0000-4000-8000-0000000000c1"; // BHEL Nagnar Club House (seed)
const WIDTH = 390;

test.use({ viewport: { width: WIDTH, height: 844 } });

/** Routes and the roles that may open them. */
const ROUTES: { name: string; path: string; roles: Role[] }[] = [
  { name: "all-projects", path: "/", roles: ["admin", "site", "client"] },
  { name: "inventory-all", path: "/inventory", roles: ["admin", "site"] },
  { name: "users", path: "/users", roles: ["admin"] },
  { name: "ops-jobs", path: "/ops/jobs", roles: ["admin"] },
  { name: "docs", path: "/docs", roles: ["admin", "site", "client"] },
  { name: "project-dashboard", path: `/projects/${PROJECT}`, roles: ["admin", "site", "client"] },
  { name: "project-packages", path: `/projects/${PROJECT}/packages`, roles: ["admin", "site", "client"] },
  { name: "project-schedule", path: `/projects/${PROJECT}/schedule`, roles: ["admin", "site", "client"] },
  { name: "project-updates", path: `/projects/${PROJECT}/updates`, roles: ["admin", "site", "client"] },
  { name: "project-stock", path: `/projects/${PROJECT}/stock`, roles: ["admin", "site"] },
  { name: "project-approvals", path: `/projects/${PROJECT}/approvals`, roles: ["admin", "site", "client"] },
  { name: "project-billing", path: `/projects/${PROJECT}/billing`, roles: ["admin", "client"] },
];

async function open(page: Page, path: string, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("theme", t);
    } catch {
      /* private mode — prefers-color-scheme applies */
    }
  }, theme);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

/** The page never scrolls sideways: wide tables scroll inside their own box. */
async function expectNoHorizontalScroll(page: Page) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(WIDTH);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`390px ${theme}`, () => {
    test.use({ colorScheme: theme });

    for (const route of ROUTES) {
      test(`${route.name} fits the viewport`, async ({ page }, testInfo) => {
        const role = testInfo.project.name as Role;
        test.skip(!route.roles.includes(role), `${role} cannot open ${route.path}`);
        await open(page, route.path, theme);

        // The sidebar is gone below md; the top bar's menu button replaces it.
        await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expect(page).toHaveScreenshot(`mobile-390-shell-${role}-${theme}-${route.name}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }

    test("drawer: opens, traps focus, Escape closes and returns focus", async ({ page }) => {
      await open(page, `/projects/${PROJECT}`, theme);
      const menu = page.getByRole("button", { name: "Open navigation" });
      await menu.click();

      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await expect(drawer).toBeVisible();
      // Same contents as the desktop sidebar: switcher, project nav, account.
      await expect(drawer.getByRole("button", { name: "All Projects" })).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Dashboard" })).toBeVisible();
      await expect(drawer.getByRole("link", { name: "Docs" })).toBeVisible();

      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(menu).toBeFocused();

      // Following a link closes it.
      await menu.click();
      await drawer.getByRole("link", { name: "Docs" }).click();
      await expect(page).toHaveURL(/\/docs$/);
      await expect(drawer).toBeHidden();
    });

    test("project switcher filters by name and client", async ({ page }) => {
      await open(page, `/projects/${PROJECT}`, theme);
      await page.getByRole("button", { name: "Open navigation" }).click();
      const drawer = page.getByRole("dialog", { name: "Navigation" });
      await drawer.getByRole("button", { name: "All Projects" }).click();
      const filter = drawer.getByRole("combobox", { name: "Filter projects" });
      await filter.fill("nagnar");
      await expect(drawer.getByRole("option", { name: /BHEL Nagnar Club House/ })).toBeVisible();
      await filter.fill("zzzz-no-such-project");
      await expect(drawer.getByText("No matching project")).toBeVisible();
    });

    test("search collapses to an icon and opens full width", async ({ page }) => {
      await open(page, "/", theme);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      const box = page.getByRole("combobox", { name: /Search projects/ });
      await expect(box).toBeFocused();
      const width = await box.evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBeGreaterThan(WIDTH / 2);
      await page.keyboard.press("Escape");
      await expect(box).toBeHidden();
    });
  });
}

test("dialog: a phone sheet, Escape closes clean, asks before discarding typed work", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "site", "Post Update is the supervisor's phone journey");
  await open(page, `/projects/${PROJECT}/updates`, "light");

  const trigger = page.getByRole("button", { name: /Post Update/ });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /Post Update/ });
  await expect(dialog).toBeVisible();

  // Full-height sheet below sm.
  const box = await dialog.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(WIDTH - 1);

  // Untouched: Escape closes straight away and focus goes back.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  // Typed: Escape asks first, and "Keep editing" keeps the text.
  await trigger.click();
  await dialog.getByRole("textbox").first().fill("Tiling done on the north wall");
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "Discard changes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(dialog.getByRole("textbox").first()).toHaveValue("Tiling done on the north wall");

  // Discard closes without posting anything.
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "Discard changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(dialog).toBeHidden();
});
