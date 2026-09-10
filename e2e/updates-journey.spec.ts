import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { config } from "dotenv";
import { writeFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });

/**
 * build/06-files-jobs-daily-updates.md §5 Playwright spec:
 *   Site: post a daily update with two photos on a throttled connection ->
 *     the update appears with thumbnails once the drain runs.
 *   Site: one photo fails to upload -> inline retry appears, the text
 *     update still posts.
 *   Client: the + Post Update button is absent, and the route rejects a
 *     direct POST.
 *
 * No real Cloudflare R2 account exists yet (docs/decisions.md, "Build 06
 * prerequisites answered") — every presigned PUT in this environment fails
 * against fake-but-valid-shaped local credentials, so "the update appears
 * WITH THUMBNAILS" cannot be verified here. What this file DOES verify,
 * against the real, currently-true behavior: a photo upload attempt fails
 * visibly (an inline Retry on that one tile), and the text update still
 * posts and appears in the real timeline regardless — the resilience
 * property the second spec item is actually testing, and the one piece of
 * both specs that doesn't need a live bucket. "The route rejects a direct
 * POST" is asserted at the layer that actually enforces it — a real client
 * session's raw insert attempt on `daily_updates`, refused by RLS — in
 * tests/integration/files-and-jobs.test.ts, not here.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000c1";

function dbConnect() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

// A real 1x1 JPEG — enough for a genuine multipart PUT attempt, not just a
// zero-byte file the browser might refuse to send.
const TEST_PHOTO_PATH = "/tmp/e2e-updates-test-photo.jpg";

test.describe("site: post a daily update, one photo fails, text still posts", () => {
  let createdUpdateId: string | null = null;

  test.afterAll(async () => {
    if (!createdUpdateId) return;
    const sql = dbConnect();
    try {
      await sql`delete from public.daily_updates where id = ${createdUpdateId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("photo shows Retry, the text update posts and appears in the timeline", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "site", "site-only journey");

    const jpeg = Buffer.from(
      "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
      "base64"
    );
    writeFileSync(TEST_PHOTO_PATH, jpeg);

    const stamp = Date.now().toString(36);
    const body = `E2E updates journey ${stamp}`;

    await page.goto(`/projects/${PROJECT}/updates`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Post Update" }).click();
    await page.getByLabel("Work Done").fill(body);
    await page.locator('input[type="file"]').setInputFiles(TEST_PHOTO_PATH);

    // The one photo tile settles into an error state — a real PUT against
    // this environment's fake R2 credentials cannot succeed.
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Post", exact: true }).click();
    await expect(page.getByText("Post Daily Update")).not.toBeVisible();
    await expect(page.getByText(body)).toBeVisible();

    const sql = dbConnect();
    try {
      const [row] = await sql`select id from public.daily_updates where body = ${body}`;
      createdUpdateId = row?.id ?? null;
    } finally {
      await sql.end({ timeout: 5 });
    }
    expect(createdUpdateId).not.toBeNull();
  });
});

test.describe("client: the + Post Update button is absent", () => {
  test("no way to open the dialog", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");

    await page.goto(`/projects/${PROJECT}/updates`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("button", { name: "Post Update" })).not.toBeVisible();
  });
});
