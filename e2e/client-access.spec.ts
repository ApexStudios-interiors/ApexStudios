import { expect, test } from "@playwright/test";

/**
 * D51: client logins are created by owner/admin from Add User with the Client
 * role and a required Project (D51 amendment, 2026-11-23); the project
 * dashboard's Client access card lists them and grants an existing one access.
 *
 * Deliberately stops short of submitting. Creating a login writes a real
 * auth.users row, and there is one Supabase project, which is production
 * (D49) — the create/cleanup path is covered by provisionAccount's unit tests
 * (features/users/service.test.ts) instead.
 */

const BHEL_PROJECT = "00000000-0000-4000-8000-0000000000c1";

test.describe("admin: Client access card", () => {
  test("lists the seeded client; no Create client login button", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    await page.goto(`/projects/${BHEL_PROJECT}`);

    await expect(page.getByRole("heading", { name: "Client access" })).toBeVisible();
    await expect(page.getByText("tvrao@example.invalid")).toBeVisible();

    // New client logins come from Users → Add User (removed here 2026-11-23).
    await expect(page.getByRole("button", { name: "Create client login" })).toHaveCount(0);
    // Each client row has Remove (this project only). Opened, never confirmed:
    // the only database is production (D49).
    await expect(page.getByRole("button", { name: "Remove" }).first()).toBeAttached();
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

test.describe("admin: a client's projects on the Users page", () => {
  test("client rows have a Projects button listing their projects", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");
    await page.goto("/users");
    const projects = page.getByRole("button", { name: /^Projects \(\d+\)$/ }).first();
    await expect(projects).toBeVisible();
    await projects.click();
    await expect(page.getByRole("heading", { name: /'s projects$/ })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
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
