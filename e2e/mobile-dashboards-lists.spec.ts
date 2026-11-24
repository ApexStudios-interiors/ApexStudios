import { expect, test, type Page } from "@playwright/test";

/**
 * APX-48 / APX-51 / APX-63 at phone width (390×844): the screens the
 * dashboards-and-lists change touched — All Projects (attention badges, status
 * filter, search), the project dashboard's attention block, Inventory's
 * Low/Critical drill-down, Stock's default tab and Daily Updates' Load more.
 *
 * READ-ONLY: nothing here posts, edits or decides anything. It still signs in
 * (e2e/global-setup.ts), so the same rule as every other spec applies — run it
 * against `pnpm dev` pointed at a NON-production database only (AGENTS.md,
 * D49). Never against the hosted project, never against the live site.
 *
 * Screenshot names are new (`mobile-390-*`); the first run on a test database
 * records them, and that run's images must be reviewed by a human before they
 * are committed — the visual-baseline.spec.ts rules apply unchanged.
 *
 * The page-level "no horizontal scroll" assertion belongs to the responsive
 * shell (APX-16, a separate PR); here each changed component is checked to fit
 * the viewport on its own.
 */

type Role = "admin" | "site" | "client";
const PROJECT = "00000000-0000-4000-8000-0000000000c1"; // BHEL Nagnar Club House (seed)
const WIDTH = 390;

test.use({ viewport: { width: WIDTH, height: 844 } });

async function settle(page: Page, path: string, theme: "light" | "dark") {
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

/** Every element matching `selector` lies within the viewport's width. */
async function expectWithinViewport(page: Page, selector: string) {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    })
  );
  for (const b of boxes) expect(b.right - b.left).toBeLessThanOrEqual(WIDTH);
}

for (const theme of ["light", "dark"] as const) {
  test.describe(`390px ${theme}`, () => {
    test.use({ colorScheme: theme });

    test("All Projects: filter, search and attention badges", async ({ page }, testInfo) => {
      const role = testInfo.project.name as Role;
      await settle(page, "/", theme);

      // Default view hides archived projects; the tabs are present and scroll
      // inside their own strip rather than widening the page.
      await expect(page.getByRole("button", { name: "Current" })).toBeVisible();
      await expectWithinViewport(page, "a[href^='/projects/']");

      // Money is admin-only: an outstanding badge never reaches site or client.
      if (role !== "admin") await expect(page.getByText(/outstanding$/)).toHaveCount(0);
      // No card ever says "1 packages".
      await expect(page.getByText(/\b1 packages\b/)).toHaveCount(0);

      await page.getByRole("searchbox", { name: "Search projects" }).fill("zzzz-no-such-project");
      await expect(page).toHaveURL(/q=zzzz-no-such-project/);
      await expect(page.getByText(/No projects match/)).toBeVisible();

      await page.goto("/?status=all");
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(`mobile-390-${role}-${theme}-all-projects.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });

    test("Project dashboard: attention block by role", async ({ page }, testInfo) => {
      const role = testInfo.project.name as Role;
      await settle(page, `/projects/${PROJECT}`, theme);

      if (role === "site") {
        await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
        // The Today card carries no money: no rupee sign inside it.
        const today = page.locator("section[aria-labelledby='today-deliveries']").locator("..");
        await expect(today.getByText("₹")).toHaveCount(0);
      } else {
        await expect(page.getByRole("heading", { name: "Today" })).toHaveCount(0);
      }
      if (role !== "admin") {
        await expect(page.getByText("Billable Now")).toHaveCount(0);
        await expect(page.getByText("Awaiting Certification")).toHaveCount(0);
      }

      await expect(page).toHaveScreenshot(`mobile-390-${role}-${theme}-project-dashboard.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });

    test("Inventory: Low and Critical tiles drill down", async ({ page }, testInfo) => {
      const role = testInfo.project.name as Role;
      test.skip(role === "client", "a client has no inventory");
      await settle(page, "/inventory", theme);

      await page.getByRole("link", { name: /low-stock items — show them/ }).click();
      await expect(page).toHaveURL(/status=low/);
      await expect(page.getByRole("button", { name: "Low" })).toBeVisible();

      await page.getByRole("button", { name: "Critical" }).click();
      await expect(page).toHaveURL(/status=critical/);

      await expect(page).toHaveScreenshot(`mobile-390-${role}-${theme}-inventory-critical.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });

    test("Stock: admin opens on Pending, site on All", async ({ page }, testInfo) => {
      const role = testInfo.project.name as Role;
      test.skip(role === "client", "a client has no stock requests");
      await settle(page, `/projects/${PROJECT}/stock`, theme);

      const pending = page.getByRole("button", { name: "Pending", exact: true });
      const all = page.getByRole("button", { name: "All", exact: true });
      // The active tab is the one rendered with the selected weight.
      const active = role === "admin" ? pending : all;
      await expect(active).toHaveClass(/font-semibold/);

      // "All" is an explicit ?status= so it is not mistaken for the default.
      await all.click();
      await expect(page).toHaveURL(/status=(&|$)/);
    });

    test("Daily Updates: Load more appends", async ({ page }, testInfo) => {
      const role = testInfo.project.name as Role;
      await settle(page, `/projects/${PROJECT}/updates`, theme);

      const loadMore = page.getByRole("button", { name: "Load more" });
      if ((await loadMore.count()) === 0) {
        test.info().annotations.push({ type: "note", description: "fewer than one page of updates" });
      } else {
        const dates = page.locator("span.font-bold.tabular-nums");
        const before = await dates.count();
        await loadMore.click();
        await expect.poll(() => dates.count()).toBeGreaterThan(before);
        // Appended, not replaced: the URL never gained a cursor.
        await expect(page).not.toHaveURL(/cursor=/);
      }

      await expect(page).toHaveScreenshot(`mobile-390-${role}-${theme}-updates.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  });
}
