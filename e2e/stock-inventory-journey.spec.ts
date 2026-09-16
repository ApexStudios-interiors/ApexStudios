import { expect, test, type Browser } from "@playwright/test";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * build/07-stock-inventory-notifications.md §3 Playwright spec:
 *   Site: raise a request (no Rate field visible) -> admin approves -> admin
 *     marks Ordered -> site marks Delivered -> inventory quantity increases
 *     -> the item appears in Billable Now (assert via the admin session).
 *   Admin: reject without a reason -> blocked with a field error, not a toast.
 *   Client: /projects/{id}/stock is forbidden; the sidebar has no Stock
 *     Requests entry.
 *   Bell: a pending request appears for admin and site, and not for the client.
 *
 * The first journey genuinely crosses three roles in one continuous flow —
 * Playwright's per-project `storageState` only fixes ONE role for an entire
 * test file, so that one test opens its own extra browser contexts with an
 * explicit `storageState` path rather than relying on the project's default,
 * and is gated to run under a single project so it executes exactly once.
 *
 * "Appears in Billable Now" is asserted against `v_billable_now` directly,
 * not through the Billing page's DOM: `features/billing/components/BillingAdmin.tsx`
 * is still Build 09's mock-data territory (billableItems() over AppContext,
 * not the real view) — the same category of honest substitution
 * updates-journey.spec.ts's own comment makes for its unbuildable R2 assertion.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE = "00000000-0000-4000-8000-0000000000e1";

function dbConnect() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

async function newContextAs(browser: Browser, role: "admin" | "site" | "client") {
  return browser.newContext({ storageState: `e2e/.auth/${role}.json` });
}

test.describe("full stock lifecycle across three roles", () => {
  let createdRequestId: string | null = null;

  test.afterAll(async () => {
    if (!createdRequestId) return;
    const sql = dbConnect();
    try {
      await sql`delete from public.stock_movements where ref_type = 'stock_request' and ref_id = ${createdRequestId}`;
      await sql`delete from public.stock_request_events where request_id = ${createdRequestId}`;
      const [row] =
        await sql`select inventory_item_id from public.stock_requests where id = ${createdRequestId}`;
      await sql`delete from public.stock_requests where id = ${createdRequestId}`;
      // Only clean up the inventory item if this test created a brand new
      // one (material_name below is unique per run) — never touch a seeded item.
      if (row?.inventory_item_id) {
        await sql`delete from public.stock_movements where inventory_item_id = ${row.inventory_item_id}`;
        await sql`delete from public.inventory_items where id = ${row.inventory_item_id}`;
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("raise -> approve -> order -> deliver, inventory increases, billable now", async ({
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "runs once, not once per role project");
    // Three sequential browser contexts, each a fresh page load against a
    // remote Mumbai-hosted database (D14: no local Postgres) — the default
    // 30s budget is tuned for a single-role, single-page-load test.
    test.setTimeout(90_000);

    const materialName = `E2E journey material ${Date.now().toString(36)}`;

    const siteCtx = await newContextAs(browser, "site");
    const sitePage = await siteCtx.newPage();
    await sitePage.goto(`/projects/${PROJECT}/stock`);
    await sitePage.waitForLoadState("networkidle");
    await sitePage.getByRole("button", { name: "New Request" }).click();
    // build §5: "Do not send `rate` to a non-admin, and do not accept it
    // from one" — the field must not even be in the DOM for site.
    await expect(sitePage.getByLabel(/Rate/)).toHaveCount(0);
    // index 0 is the "Select a package"/"Loading…" placeholder.
    await sitePage.getByLabel("Package").selectOption({ index: 1 });
    await sitePage.getByLabel("Material").fill(materialName);
    await sitePage.getByLabel("Quantity").fill("7");
    await sitePage.getByLabel("Unit").selectOption({ index: 1 });
    await sitePage.getByRole("button", { name: "Submit" }).click();
    await expect(sitePage.getByText("New Stock Request")).not.toBeVisible({ timeout: 10_000 });
    await siteCtx.close();

    const sql = dbConnect();
    let requestId: string;
    try {
      const [row] = await sql`
        select id from public.stock_requests where material_name = ${materialName} order by created_at desc limit 1`;
      if (!row) throw new Error(`no stock_requests row found for material_name ${materialName}`);
      requestId = row.id;
      createdRequestId = requestId;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const adminCtx = await newContextAs(browser, "admin");
    const adminPage = await adminCtx.newPage();
    await adminPage.goto(`/projects/${PROJECT}/stock`);
    await adminPage.waitForLoadState("networkidle");
    const adminRow = adminPage.locator("tr", { hasText: materialName });
    await adminRow.getByRole("button", { name: "Approve" }).click();
    // `getByText` substring-matches by default: "Ordered" (the eventual
    // status) is a substring of "Mark Ordered" (the next row's own button,
    // present the instant status becomes "approved") — without `exact`,
    // this resolved true immediately, before the click below or its
    // mutation ever ran, and the subsequent `adminCtx.close()` cancelled
    // the in-flight request. Confirmed live: the request was left stuck on
    // "approved" forever. `exact: true` only matches the status badge's own
    // full text content.
    await expect(adminRow.getByText("Approved", { exact: true })).toBeVisible({ timeout: 10_000 });
    await adminRow.getByRole("button", { name: "Mark Ordered" }).click();
    await expect(adminRow.getByText("Ordered", { exact: true })).toBeVisible({ timeout: 10_000 });
    await adminCtx.close();

    const siteCtx2 = await newContextAs(browser, "site");
    const sitePage2 = await siteCtx2.newPage();
    await sitePage2.goto(`/projects/${PROJECT}/stock`);
    await sitePage2.waitForLoadState("networkidle");
    const siteRow = sitePage2.locator("tr", { hasText: materialName });
    await siteRow.getByRole("button", { name: "Mark Delivered" }).click();
    await expect(siteRow.getByText("Delivered", { exact: true })).toBeVisible({ timeout: 10_000 });
    await siteCtx2.close();

    const sql2 = dbConnect();
    try {
      const [movement] = await sql2`
        select qty from public.stock_movements
         where ref_type = 'stock_request' and ref_id = ${requestId}`;
      expect(Number(movement?.qty)).toBe(7);

      const [billable] = await sql2`select 1 from public.v_billable_now where source_id = ${requestId}`;
      expect(billable, "delivered material should appear in v_billable_now").toBeDefined();
    } finally {
      await sql2.end({ timeout: 5 });
    }
  });
});

test.describe("admin: reject without a reason is blocked with a field error", () => {
  test("no reason -> field error, not a toast", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");

    const sql = dbConnect();
    const ref = `E2E-REJECT-${Date.now().toString(36)}`;
    let requestId: string;
    try {
      const [row] = await sql`
        insert into public.stock_requests (org_id, project_id, package_id, ref_no, material_name, qty, unit, status, requested_by, created_by)
        select org_id, ${PROJECT}, ${PACKAGE}, ${ref}, 'E2E reject test material', 1, 'bag', 'pending', id, id
          from public.profiles where email = 'ravi@beapex.in'
        returning id`;
      if (!row) throw new Error("insert returned no row");
      requestId = row.id;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      await page.goto(`/projects/${PROJECT}/stock`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("tr", { hasText: "E2E reject test material" });
      await row.getByRole("button", { name: "Reject" }).click();
      await expect(page.getByText("Reject Stock Request")).toBeVisible();
      // DialogShell isn't a portal — its own "Reject" submit button is the
      // last such element in the DOM (every row's own Reject button stays
      // mounted behind the overlay), not the only one on the page.
      await page.getByRole("button", { name: "Reject", exact: true }).last().click();
      await expect(page.getByText("Please give a reason.")).toBeVisible();
      // Still open — a blocked field error, not a toast that would have
      // closed the dialog and reported success/failure generically.
      await expect(page.getByText("Reject Stock Request")).toBeVisible();
    } finally {
      const cleanup = dbConnect();
      await cleanup`delete from public.stock_requests where id = ${requestId}`;
      await cleanup.end({ timeout: 5 });
    }
  });
});

test.describe("client: no stock access at all", () => {
  test("/projects/{id}/stock is forbidden, no sidebar entry", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");

    await page.goto(`/projects/${PROJECT}`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("link", { name: "Stock Requests" })).not.toBeVisible();

    await page.goto(`/projects/${PROJECT}/stock`);
    await expect(page.getByText("You don't have access to this")).toBeVisible();
  });
});

test.describe("bell: pending request visible to admin and site, not client", () => {
  test("notifications bell reflects role scoping", async ({ page }, testInfo) => {
    const role = testInfo.project.name;
    if (role !== "admin" && role !== "site" && role !== "client") test.skip();

    const sql = dbConnect();
    const stamp = Date.now().toString(36);
    const ref = `E2E-BELL-${role}-${stamp}`;
    // Unique per (role, run): the three projects run in parallel, and a
    // fixed material name would let one project's row show up as a false
    // positive in another project's own assertion.
    const materialName = `E2E bell test material ${role} ${stamp}`;
    let requestId: string;
    try {
      const [row] = await sql`
        insert into public.stock_requests (org_id, project_id, package_id, ref_no, material_name, qty, unit, status, requested_by, created_by)
        select org_id, ${PROJECT}, ${PACKAGE}, ${ref}, ${materialName}, 1, 'bag', 'pending', id, id
          from public.profiles where email = 'ravi@beapex.in'
        returning id`;
      if (!row) throw new Error("insert returned no row");
      requestId = row.id;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Notifications" }).click();
      const bellItem = page.getByText(materialName);
      if (role === "client") {
        await expect(bellItem).not.toBeVisible();
      } else {
        await expect(bellItem).toBeVisible();
      }
    } finally {
      const cleanup = dbConnect();
      await cleanup`delete from public.stock_requests where id = ${requestId}`;
      await cleanup.end({ timeout: 5 });
    }
  });
});
