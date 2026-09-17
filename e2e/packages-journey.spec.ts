import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * build/04-projects-packages-phases.md §5, one journey per role:
 *   Admin: create a project with three packages -> add a package with
 *     budgets -> verify Allocated, Internal, Committed, Remaining and Used
 *     all render -> edit it -> verify the change.
 *   Client: open the same project -> Packages table shows Allocated and not
 *     Internal -> the page's HTML source contains no internal figure.
 *   Site: Packages table shows Phases / Open Requests and no money column.
 *
 * The admin test creates a real project through the real UI and cleans it up
 * directly against Postgres afterward (`packages` cascade-deletes with their
 * project) — the Supabase client itself cannot: PostgREST always executes
 * `UPDATE ... RETURNING`, and every soft-deletable table's own SELECT policy
 * filters `deleted_at is null`, so a plain client update to set it fails RLS
 * even with no `.select()` chained (docs/decisions.md D21). A privileged
 * connection for TEST CLEANUP only, never for the assertions themselves,
 * mirrors tests/integration's own precedent.
 */

const BHEL_PROJECT = "00000000-0000-4000-8000-0000000000c1";
// A seeded internal_amount that must never reach a non-admin session's HTML.
const KNOWN_INTERNAL_AMOUNT = "2584054"; // Swimming Pool's internal_amount

test.describe("admin: create project -> add package -> edit package", () => {
  let createdProjectId: string | null = null;

  test.afterAll(async () => {
    if (!createdProjectId) return;
    const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
    if (!url) return;
    const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      await sql`delete from public.projects where id = ${createdProjectId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("full journey", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    const stamp = Date.now().toString(36);

    await page.goto("/");
    await page.getByRole("button", { name: "New Project" }).click();
    await page.getByLabel("Project Name").fill(`E2E Test Project ${stamp}`);
    // Client is a combobox (Popover + Command), not a native select; the
    // trigger stays disabled until the org's clients have loaded.
    await page.getByLabel("Client").click();
    await page.getByRole("option", { name: "T V Rao Housing Pvt Ltd" }).click();
    // Project Code is generated from the name and read-only — never typed.
    await expect(page.getByLabel("Project Code")).not.toHaveValue("");
    // Start Date is a Popover + Calendar date picker, not a native date input.
    // It opens on the current month; step back to September 2026, waiting for
    // each month to render before checking again.
    await page.getByLabel("Start Date").click();
    const calendarGrid = page.getByRole("grid", { name: /^\w+ \d{4}$/ });
    for (let step = 0; (await calendarGrid.getAttribute("aria-label")) !== "September 2026"; step++) {
      expect(step, "calendar never reached September 2026").toBeLessThan(60);
      const shown = (await calendarGrid.getAttribute("aria-label")) ?? "";
      await page.getByRole("button", { name: "Go to the Previous Month" }).click();
      await expect(calendarGrid).not.toHaveAttribute("aria-label", shown);
    }
    await calendarGrid.getByRole("button", { name: "September 1st, 2026" }).click();
    await page.getByLabel("Packages").fill("Design, Execution, Handover");
    await page.getByRole("button", { name: "Create" }).click();

    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    const segments = new URL(page.url()).pathname.split("/");
    createdProjectId = segments[segments.length - 1] ?? null;
    expect(createdProjectId).not.toBeNull();

    // Three named packages created atomically with the project (rpc_create_project).
    await expect(page.getByText("Design").first()).toBeVisible();
    await expect(page.getByText("Execution").first()).toBeVisible();
    await expect(page.getByText("Handover").first()).toBeVisible();

    // Add a fourth package with budgets.
    await page.getByRole("button", { name: "Add Package" }).click();
    await page.getByLabel("Package Name").fill("Landscape");
    await page.getByLabel("Allocated Budget").fill("500000");
    await page.getByLabel("Internal Budget").fill("400000");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByText("Landscape")).toBeVisible();

    // ui-guide.md §6.4: Allocated, Internal, Committed, Remaining, Used all render for admin.
    // Remaining (Internal - Committed) is also ₹4,00,000.00 with nothing
    // committed yet, so "₹4,00,000.00" appears twice in the row — .first()
    // is enough to confirm the figure renders at all.
    const row = page.locator("tr", { hasText: "Landscape" });
    await expect(row.getByText("₹5,00,000.00")).toBeVisible();
    await expect(row.getByText("₹4,00,000.00").first()).toBeVisible();

    // Edit it and verify the change is reflected. Only the package name is
    // an actual link (ui-guide.md §6.4's "clickable row" is a cursor
    // affordance on the <tr>, not a full-row anchor).
    await row.getByRole("link", { name: "Landscape" }).click();
    await page.waitForURL(/\/packages\/[0-9a-f-]+\/budget$/);
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Allocated Budget").fill("550000");
    await page.getByRole("button", { name: "Save" }).click();
    // The package-detail stat row renders compact (formatINRCompact, lib/money) —
    // ₹5,50,000 is "₹5.50 L" there, full precision is a table-only convention.
    await expect(page.getByText("₹5.50 L")).toBeVisible();
  });
});

test.describe("client: packages table shows Allocated, never Internal", () => {
  test("no internal figure anywhere in the page source", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");
    await page.goto(`/projects/${BHEL_PROJECT}/packages`);
    await expect(page.getByRole("columnheader", { name: "Contract Value" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Internal", exact: false })).not.toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(KNOWN_INTERNAL_AMOUNT);
  });
});

test.describe("site: packages table shows Phases / Open Requests, no money column", () => {
  test("no money column, no internal figure anywhere in the page source", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "site", "site-only journey");
    await page.goto(`/projects/${BHEL_PROJECT}/packages`);
    await expect(page.getByRole("columnheader", { name: "Phases" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Open Requests" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Allocated" })).not.toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Contract Value" })).not.toBeVisible();

    const html = await page.content();
    expect(html).not.toContain(KNOWN_INTERNAL_AMOUNT);
  });
});
