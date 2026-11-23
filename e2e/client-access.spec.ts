import { expect, test } from "@playwright/test";

/**
 * D51: client logins are created and granted per project, by owner/admin only —
 * from the project dashboard's Client access card, or from Add User with the
 * Client role and a required Project (D51 amendment, 2026-11-23).
 *
 * Deliberately stops short of submitting. Creating a login writes a real
 * auth.users row, and there is one Supabase project, which is production
 * (D49) — the create/cleanup path is covered by provisionAccount's unit tests
 * (features/users/service.test.ts) instead.
 */

const BHEL_PROJECT = "00000000-0000-4000-8000-0000000000c1";

test.describe("admin: Client access card", () => {
  test("lists the seeded client and opens Create client login", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    await page.goto(`/projects/${BHEL_PROJECT}`);

    await expect(page.getByRole("heading", { name: "Client access" })).toBeVisible();
    await expect(page.getByText("tvrao@example.invalid")).toBeVisible();

    await page.getByRole("button", { name: "Create client login" }).click();
    await expect(page.getByRole("heading", { name: "Create client login" })).toBeVisible();
    await page.getByLabel("Username").fill("someclient");
    await expect(page.getByText("Signs in as someclient@beapex.in")).toBeVisible();
    // No role choice: a login made here is always a client.
    await expect(page.getByLabel("Role")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancel" }).click();
  });

  test("Add User offers Client, which asks for a project", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    await page.goto("/users");
    await page.getByRole("button", { name: "Add User" }).click();
    // Staff roles: no Project field.
    await expect(page.getByLabel("Project")).toHaveCount(0);
    await page.getByLabel("Role").click();
    await expect(page.getByRole("option", { name: "Admin" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Site Supervisor" })).toBeVisible();
    // D51 amendment (2026-11-23): Client is offered, and requires a project.
    await page.getByRole("option", { name: "Client" }).click();
    await expect(page.getByLabel("Project")).toBeVisible();
    // Stops short of submitting — see the note at the top of this file.
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("site and client: no Client access card", () => {
  test("the card is not rendered", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "admin", "non-admin journey");
    await page.goto(`/projects/${BHEL_PROJECT}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Client access" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create client login" })).toHaveCount(0);
  });
});
