import { expect, test } from "@playwright/test";

/**
 * The visual-parity baseline for the prototype, tag `proto-v1`.
 *
 * Build 04 onward replaces AppContext with real data feature by feature. These
 * images are what "no pixel changed" is measured against, and they cannot be
 * recaptured once the prototype is gone. See docs/build/01-foundations.md §3.17.
 *
 * Each Playwright project (admin/site/client) now carries a REAL signed-in
 * storage state from e2e/global-setup.ts (build/03-auth-and-rbac.md) — no more
 * in-page role switching, because that UI no longer exists. AppContext's
 * `role` is locked to the real session for the run.
 *
 * ── The baseline is STALE, and refreshing it is BLOCKED ──────────────────────
 *
 * The images in `__screenshots__/proto-v1/` were last written by Build 09
 * (PR #14). Since then the D53 shadcn/ui adoption and PR #39's pagination
 * landed. PR #38 restored the original palette and Inter, so colour, type and
 * spacing are NOT a source of drift — the controls and the table footers are.
 * Expected to fail, by inspection of what those PRs changed:
 *
 *   inventory-all, project-inventory, project-stock, project-approvals,
 *   project-billing, package-billing, users   — every table is now capped at
 *     10 rows with a `TablePagination` footer under it, and the inventory and
 *     stock filters are Base UI `Select`/`Input` rather than the hand-rolled
 *     controls. Row count and full-page height both change.
 *   project-dashboard (admin only)            — gained `ClientAccessCard` (D51).
 *
 * Expected to still match: all-projects, project-packages, package-detail,
 * project-schedule, package-schedule, project-updates. Their components moved
 * into their feature's own components folder byte-for-byte (or with an import
 * line changed)
 * and `components/ui/button.tsx` kept the original four variants and two sizes,
 * so nothing on those pages should have moved a pixel.
 *
 * **Refreshing it needs a database, and there is none.** `pnpm test:e2e` signs
 * in and writes rows, and the only Supabase project is production (D49), so a
 * `--update-snapshots` run today would both write test data into live data and
 * bake live data into the baseline. A human must, in this order:
 *
 *   1. Wait for a non-production Supabase project (the same prerequisite that
 *      is holding `pnpm test:rls` and CI's `database` job).
 *   2. Migrate and seed it, point `.env.local` and `PLAYWRIGHT_BASE_URL` at it,
 *      and confirm `pnpm db:link` does NOT resolve to `SUPABASE_PROD_PROJECT_REF`.
 *   3. Run `pnpm test:e2e -- visual-baseline.spec.ts` FIRST without
 *      `--update-snapshots`, and read the diff images. A refresh that is not
 *      reviewed is a baseline that records whatever regression was live.
 *   4. Only then re-run with `--update-snapshots`, and review the committed
 *      PNG diff screen by screen against `docs/ui-guide.md` — that document,
 *      not these images, is the functional spec.
 *
 * Do not regenerate these piecemeal from a dev machine pointed at production,
 * and do not delete the stale images to make the suite pass.
 */

type Role = "admin" | "site" | "client";

// Build 04 re-keyed every mock id to its real database UUID (lib/data.ts's own
// header comment explains why) — these two constants have to track that.
const PROJECT = "00000000-0000-4000-8000-0000000000c1"; // BHEL Nagnar Club House
const MODULE = "00000000-0000-4000-8000-0000000000e1"; // Swimming Pool

/** Routes, and which roles may reach each one. */
const ROUTES: { name: string; path: string; roles: Role[] }[] = [
  { name: "all-projects", path: "/", roles: ["admin", "site", "client"] },
  { name: "inventory-all", path: "/inventory", roles: ["admin", "site"] },
  { name: "users", path: "/users", roles: ["admin"] },
  { name: "project-dashboard", path: `/projects/${PROJECT}`, roles: ["admin", "site", "client"] },
  { name: "project-packages", path: `/projects/${PROJECT}/packages`, roles: ["admin", "site", "client"] },
  {
    // Build 04: /packages/:moduleId now redirects to its default tab
    // (02-lld.md §8.1) — the bare URL is no longer where this route settles.
    name: "package-detail",
    path: `/projects/${PROJECT}/packages/${MODULE}/budget`,
    roles: ["admin", "site", "client"],
  },
  { name: "project-schedule", path: `/projects/${PROJECT}/schedule`, roles: ["admin", "site", "client"] },
  {
    // build/05-schedule-and-progress.md §3.5 step 2: a new route, not present
    // in proto-v1 (the prototype's Schedule tab lived only at the project
    // level). No prior baseline exists for it — this run establishes one,
    // it does not compare against a frozen prototype image.
    name: "package-schedule",
    path: `/projects/${PROJECT}/packages/${MODULE}/schedule`,
    roles: ["admin", "site", "client"],
  },
  { name: "project-updates", path: `/projects/${PROJECT}/updates`, roles: ["admin", "site", "client"] },
  { name: "project-inventory", path: `/projects/${PROJECT}/inventory`, roles: ["admin", "site"] },
  { name: "project-stock", path: `/projects/${PROJECT}/stock`, roles: ["admin", "site"] },
  { name: "project-approvals", path: `/projects/${PROJECT}/approvals`, roles: ["admin", "site", "client"] },
  { name: "project-billing", path: `/projects/${PROJECT}/billing`, roles: ["admin", "client"] },
  {
    // build/09-billing.md — a new route, not present in proto-v1 (the
    // prototype's Billing tab lived only at the project level, same
    // reasoning as package-schedule above). No prior baseline exists for
    // it; this run establishes one, it does not compare against a frozen
    // prototype image.
    name: "package-billing",
    path: `/projects/${PROJECT}/packages/${MODULE}/billing`,
    roles: ["admin", "client"],
  },
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
