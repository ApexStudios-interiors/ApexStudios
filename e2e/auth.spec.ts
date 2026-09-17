import { expect, test } from "@playwright/test";

/**
 * build/03-auth-and-rbac.md §3.3's "assert the negative directly" check, scoped
 * to what Build 03 actually enforces.
 *
 * The per-SECTION role check (e.g. client hitting /stock) stays a client-side
 * redirect for now — see app/(app)/projects/[projectId]/layout.tsx's own
 * comment: real per-feature enforcement needs real project ids and real RLS,
 * which land with Build 04's data migration, not before. What Build 03 DOES
 * enforce for real is the SESSION requirement — middleware.ts and every (app)
 * route — which is what this file proves, unauthenticated.
 */
test.describe("unauthenticated access", () => {
  // Runs with no storage state at all, unlike the role projects.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a protected route redirects to /login, not to the page itself", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the redirect preserves where the user was headed", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login\?next=%2Fusers/);
  });

  test("/login itself is reachable without a session", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  // D51: one sign-in for every role — username + password, no magic link.
  test("/login asks for a username and offers no magic link", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByText(/magic link/i)).toHaveCount(0);
  });

  test("the removed magic-link routes are not public", async ({ page }) => {
    for (const path of ["/client-login", "/auth/callback", "/auth/error"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login\?next=/);
    }
  });

  test("/api/health needs no session", async ({ page }) => {
    const res = await page.request.get("/api/health");
    // 503 is a legitimate response here (placeholder R2 creds locally) — the
    // point is it is reachable at all, unauthenticated, per its own contract.
    expect([200, 503]).toContain(res.status());
  });
});
