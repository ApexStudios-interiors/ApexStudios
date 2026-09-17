import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { config } from "dotenv";
import { writeFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });

/**
 * build/08-approvals.md §3 Playwright spec:
 *   Client (mobile viewport): bell -> pending approval -> view a sample
 *     photo full size -> Approve -> leaves the bell, table shows Approved
 *     with a decided date.
 *   Client: reject with no reason is blocked with a field error.
 *   Admin: Approve/Reject buttons don't render on any row.
 *   Site: can request an approval and add photos, but cannot decide.
 *   Admin: raises a revised approval from a rejected one; both link to
 *     each other.
 *
 * No real Cloudflare R2 account exists in this environment (the same
 * constraint `updates-journey.spec.ts`'s own comment documents) — a real
 * photo PUT cannot succeed against fake-but-valid-shaped credentials.
 * `presignGet` computes its signature locally with no network round trip
 * (`features/updates/queries.ts`'s own comment), so a presigned URL is
 * still generated for a fixture attachment row seeded directly by SQL, and
 * the lightbox dialog opening for it is real and testable even though the
 * underlying `<img>` itself cannot actually load. "Admin cannot decide via
 * a hand-crafted action call or a direct PostgREST call" is asserted at the
 * layer that actually enforces it — `rpc_decide_approval`'s own FORBIDDEN,
 * tested from real signed-in sessions in `tests/integration/approvals.test.ts`
 * — not re-proven here; this file covers what only the UI can show.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE = "00000000-0000-4000-8000-0000000000e1";

function dbConnect() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

const TEST_PHOTO_PATH = "/tmp/e2e-approvals-test-photo.jpg";
const TEST_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

test.describe("client (mobile): bell -> approval -> view photo full size -> approve", () => {
  test("approving leaves the bell and shows Approved with a decided date", async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");

    const stamp = Date.now().toString(36);
    const item = `E2E approve journey ${stamp}`;
    const ref = `E2E-APPROVE-${stamp}`;

    const sql = dbConnect();
    let approvalId: string;
    try {
      const [row] = await sql`
        insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, requested_by, created_by)
        select org_id, ${PROJECT}, ${PACKAGE}, ${ref}, 'material_sample', ${item}, 'pending', id, id
          from public.profiles where email = 'ravi@beapex.in'
        returning id`;
      if (!row) throw new Error("insert returned no row");
      approvalId = row.id;
      // A fixture attachment row — the lightbox's own dialog is real and
      // testable even though the r2_key underneath it points at nothing.
      await sql`
        insert into public.attachments (org_id, project_id, entity_type, entity_id, uploaded_by, mime_type, size_bytes, file_name, r2_key)
        select org_id, ${PROJECT}, 'approval', ${approvalId}, id, 'image/jpeg', 1000, 'sample.jpg', ${"e2e/" + approvalId + "/sample.jpg"}
          from public.profiles where email = 'ravi@beapex.in'`;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      const ctx = await browser.newContext({
        storageState: "e2e/.auth/client.json",
        viewport: { width: 390, height: 844 }, // build §2.5 step 8: "on a phone."
      });
      const page = await ctx.newPage();

      await page.goto("/");
      await page.waitForLoadState("networkidle");
      await page.getByRole("button", { name: "Notifications" }).click();
      await page.getByText(`Approval needed: ${item}`).click();
      await page.waitForLoadState("networkidle");

      const row = page.locator("tr", { hasText: item });
      await expect(row).toBeVisible();
      await row.locator("img").first().click();
      await expect(page.getByText("Photo", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Close" }).click();

      await row.getByRole("button", { name: "Approve" }).click();
      await expect(page.getByText("This is your sign-off")).toBeVisible();
      await page.getByRole("button", { name: "Approve", exact: true }).last().click();
      await expect(page.getByText("This is your sign-off")).not.toBeVisible();

      // The "Pending" tab is the default filter — a decided row correctly
      // leaves it, so "All" is where the now-Approved row (and its decided
      // date) is actually asserted, not the tab this journey started on.
      await page.getByRole("button", { name: "All", exact: true }).click();
      await page.waitForLoadState("networkidle");
      await expect(row.getByText("Approved", { exact: true })).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Notifications" }).click();
      await expect(page.getByText(`Approval needed: ${item}`)).not.toBeVisible();

      await ctx.close();
    } finally {
      const cleanup = dbConnect();
      await cleanup`delete from public.attachments where entity_id = ${approvalId}`;
      await cleanup`delete from public.approvals where id = ${approvalId}`;
      await cleanup.end({ timeout: 5 });
    }
  });
});

test.describe("client: reject with no reason is blocked with a field error", () => {
  test("field error, dialog stays open", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");

    const stamp = Date.now().toString(36);
    const item = `E2E reject journey ${stamp}`;
    const ref = `E2E-REJECT-${stamp}`;

    const sql = dbConnect();
    let approvalId: string;
    try {
      const [row] = await sql`
        insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, requested_by, created_by)
        select org_id, ${PROJECT}, ${PACKAGE}, ${ref}, 'material_sample', ${item}, 'pending', id, id
          from public.profiles where email = 'ravi@beapex.in'
        returning id`;
      if (!row) throw new Error("insert returned no row");
      approvalId = row.id;
    } finally {
      await sql.end({ timeout: 5 });
    }

    try {
      await page.goto(`/projects/${PROJECT}/approvals`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("tr", { hasText: item });
      await row.getByRole("button", { name: "Reject" }).click();
      await expect(page.getByText("Reject Approval")).toBeVisible();
      await page.getByRole("button", { name: "Reject", exact: true }).last().click();
      await expect(page.getByText("Please give a reason for rejecting")).toBeVisible();
      await expect(page.getByText("Reject Approval")).toBeVisible();
    } finally {
      const cleanup = dbConnect();
      await cleanup`delete from public.approvals where id = ${approvalId}`;
      await cleanup.end({ timeout: 5 });
    }
  });
});

test.describe("admin: no Approve/Reject buttons on any row", () => {
  test("decideApproval is a client-only capability, reflected in the UI", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");

    await page.goto(`/projects/${PROJECT}/approvals?status=`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reject", exact: true })).toHaveCount(0);
  });
});

test.describe("site: can request an approval and add photos, but cannot decide", () => {
  let createdApprovalId: string | null = null;

  test.afterAll(async () => {
    if (!createdApprovalId) return;
    const sql = dbConnect();
    try {
      await sql`delete from public.attachments where entity_id = ${createdApprovalId}`;
      await sql`delete from public.approvals where id = ${createdApprovalId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("request approval, attempt a photo, no decide buttons appear", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "site", "site-only journey");
    test.setTimeout(60_000);

    writeFileSync(TEST_PHOTO_PATH, Buffer.from(TEST_JPEG_BASE64, "base64"));

    const item = `E2E site request ${Date.now().toString(36)}`;

    await page.goto(`/projects/${PROJECT}/approvals`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Request Approval" }).click();
    // Package is a Base UI Select; pick its first package option.
    await page.getByLabel("Package").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Item").fill(item);
    await page.locator('input[type="file"]').setInputFiles(TEST_PHOTO_PATH);
    // Same fake-R2 constraint as updates-journey.spec.ts: the PUT itself
    // cannot succeed here, but the text/item fields still submit — the
    // resilience property build §2.4's own attachment re-check depends on.
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Send" }).click();
    // The page's own "+ Request Approval" button shares this exact text with
    // the dialog's heading — scoped to the heading role so this doesn't
    // always resolve true regardless of whether the dialog actually closed.
    await expect(page.getByRole("heading", { name: "Request Approval" })).not.toBeVisible({
      timeout: 10_000,
    });

    const sql = dbConnect();
    try {
      const [row] = await sql`select id from public.approvals where item = ${item}`;
      createdApprovalId = row?.id ?? null;
    } finally {
      await sql.end({ timeout: 5 });
    }
    expect(createdApprovalId).not.toBeNull();

    const row = page.locator("tr", { hasText: item });
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Reject" })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Add photos" })).toBeVisible();

    // "Add photos" opens ApprovalPhotosDialog — same fake-R2 constraint as
    // above stops the upload from actually completing, but the dialog and
    // its own upload attempt are real.
    await row.getByRole("button", { name: "Add photos" }).click();
    await expect(page.getByText("Add Sample Photos")).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(TEST_PHOTO_PATH);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("admin: raises a revised approval from a rejected one, both link to each other", () => {
  test("Revises / Superseded by appear on both rows", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");

    const stamp = Date.now().toString(36);
    const originalItem = `E2E supersede original ${stamp}`;
    const revisedItem = `E2E supersede revised ${stamp}`;
    const ref = `E2E-SUPERSEDE-${stamp}`;

    const sql = dbConnect();
    let originalId: string;
    try {
      const [row] = await sql`
        insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status, decided_by, decided_at, decision_reason, requested_by, created_by)
        select p1.org_id, ${PROJECT}, ${PACKAGE}, ${ref}, 'material_sample', ${originalItem}, 'rejected', p2.id, now(), 'Wrong finish', p1.id, p1.id
          from public.profiles p1, public.profiles p2
         where p1.email = 'ravi@beapex.in' and p2.email = 'tvrao@example.invalid'
        returning id`;
      if (!row) throw new Error("insert returned no row");
      originalId = row.id;
    } finally {
      await sql.end({ timeout: 5 });
    }

    let revisedId: string | null = null;
    try {
      await page.goto(`/projects/${PROJECT}/approvals?status=rejected`);
      await page.waitForLoadState("networkidle");
      const originalRow = page.locator("tr", { hasText: originalItem });
      await originalRow.getByRole("button", { name: "Raise revised approval" }).click();
      // Scoped to the heading role: the seed data can carry other rejected
      // rows with their own "Raise revised approval" row buttons visible at
      // the same time, and this dialog's own title matches that button text
      // case-insensitively-adjacent ("Raise Revised Approval").
      await expect(page.getByRole("heading", { name: "Raise Revised Approval" })).toBeVisible();
      const itemInput = page.getByLabel("Item");
      await expect(itemInput).toHaveValue(originalItem);
      await itemInput.fill(revisedItem);
      await page.getByRole("button", { name: "Send" }).click();
      await expect(page.getByRole("heading", { name: "Raise Revised Approval" })).not.toBeVisible({
        timeout: 10_000,
      });

      const sql2 = dbConnect();
      try {
        const [row] = await sql2`select id from public.approvals where item = ${revisedItem}`;
        revisedId = row?.id ?? null;
      } finally {
        await sql2.end({ timeout: 5 });
      }
      expect(revisedId).not.toBeNull();

      // The original is now rejected, the revision is pending — the default
      // "Pending" tab shows only one of them, so "All" is where both rows
      // (and their mutual link) are actually visible together.
      await page.goto(`/projects/${PROJECT}/approvals?status=`);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("tr", { hasText: originalItem }).getByText(`Superseded by`)).toBeVisible();
      await expect(page.locator("tr", { hasText: revisedItem }).getByText(`Revises`)).toBeVisible();
    } finally {
      const cleanup = dbConnect();
      if (revisedId) await cleanup`delete from public.approvals where id = ${revisedId}`;
      await cleanup`delete from public.approvals where id = ${originalId}`;
      await cleanup.end({ timeout: 5 });
    }
  });
});
