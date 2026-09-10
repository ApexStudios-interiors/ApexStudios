import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * build/05-schedule-and-progress.md §4 Playwright spec, one journey per role:
 *
 *   Site: open Schedule -> click a task bar -> move the progress slider to
 *     100 -> the bar fills, and the phase group's and package's own rollup
 *     percentages update. The build file's own "...and the phase shows as
 *     Billable in the Billing tab" cannot be verified here: that tab is still
 *     AppContext/mock data
 *     (app/(app)/projects/[projectId]/packages/[moduleId]/billing/page.tsx's
 *     own comment says so — "Build 09 converts this tab") — a real task's
 *     progress has no real surface there to show up on yet. T-17 itself (the
 *     RPC's billing_status flip) is exercised directly against the database
 *     in tests/integration/schedule.test.ts instead, which is the correct
 *     layer for it until Build 09 lands.
 *   Client: click a bar -> a read-only toast, no dialog opens.
 *   Admin: add a task dated beyond the 14-week default -> the viewport
 *     widens to include it, visible without manual scrolling.
 *
 * Site's journey mutates real seed data — the RPC it drives has a real,
 * commercial-meaning side effect (a phase's billing_status) — and restores
 * both columns directly against Postgres in `afterAll`, mirroring
 * packages-journey.spec.ts's own precedent: PostgREST's RLS-enforced
 * RETURNING makes a plain client revert impossible for the same reason a
 * soft delete is (docs/decisions.md D21), and there is no "undo" RPC to call
 * from a raw connection anyway — `rpc_set_task_progress` checks
 * `is_member_of()`/`auth_role()`, both null outside a real PostgREST session,
 * so it would refuse a call made this way. Admin's created task carries no
 * commercial meaning; it deletes itself in `afterAll`.
 *
 * Site and Admin both read/write the SAME real seeded package (Swimming
 * Pool) — its task count and rollup percentage, specifically — so this file
 * depends on Playwright's own `workers: 1` under CI (playwright.config.ts):
 * run with more than one worker, the two can race (observed live, locally,
 * before pinning this down) and either can see the other's not-yet-cleaned-up
 * data. Run this file locally with `--workers=1` for the same reason.
 */

const PROJECT = "00000000-0000-4000-8000-0000000000c1";
// Swimming Pool's "Overflow channel and balance tank" is a single-task phase
// (Gantt.tsx's own task list, cross-checked live against apex-dev) — the one
// task reaching 100% is enough to flip the whole phase, no fixture needed.
const OVERFLOW_TASK = "00000000-0000-4000-8000-000000000103";
const OVERFLOW_PHASE = "00000000-0000-4000-8000-0000000000f4";

function dbConnect() {
  const url = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("SUPABASE_DB_URL is not set");
  return postgres(url, { max: 1, prepare: false, onnotice: () => {} });
}

test.describe("site: move a task's progress to 100 via the slider", () => {
  test.afterAll(async () => {
    const sql = dbConnect();
    try {
      await sql`update public.tasks set progress_pct = 0 where id = ${OVERFLOW_TASK}`;
      await sql`update public.phases set billing_status = 'unresolved' where id = ${OVERFLOW_PHASE}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("bar fills, phase group and package percentage update", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "site", "site-only journey");

    await page.goto(`/projects/${PROJECT}/schedule`);
    await page.waitForLoadState("networkidle");

    const bar = page.locator('[title^="Overflow channel and balance tank:"]');
    await expect(bar).toBeVisible();
    // A real, plain click — not force:true. This 3-week bar's own overflow
    // used to swallow every click past its first week (Gantt.tsx's own fix
    // comment); a real click succeeding here is this test's regression guard
    // for that fix, same as the pgTAP/integration precedent elsewhere.
    await bar.click();
    await expect(page.getByRole("heading", { name: "Overflow channel and balance tank" })).toBeVisible();

    const slider = page.locator('input[type="range"]');
    await expect(slider).toBeVisible();
    // A real mouse drag-and-release on a native range input is flaky under
    // CDP-driven synthetic pointer events (observed live: an identical drag
    // sometimes lands on 100, sometimes never leaves 0). Dispatching the same
    // two events TaskDetailDialog.tsx itself listens for — the native
    // `input` React's onChange relies on, then `pointerup`, which fires
    // commitProgress — exercises the exact same code path deterministically,
    // without depending on the browser's own drag physics.
    await slider.evaluate((el: HTMLInputElement) => {
      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
      const setter = descriptor?.set;
      if (!setter) throw new Error("HTMLInputElement.prototype.value has no setter");
      setter.call(el, "100");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });

    // commitProgress fires on release; the hint reflects the optimistic value
    // immediately, but waiting for it also gives the server round-trip behind
    // it time to settle before the reload below reads the persisted state.
    // Scoped to Field's own hint div (DialogShell.tsx) — a bare getByText
    // ("100%") also matches the two already-100% seeded tasks elsewhere on
    // the page behind the dialog.
    await expect(page.locator("div.text-xs.text-muted-foreground.mt-1\\.5")).toHaveText("100%");

    await page.getByRole("button", { name: "Cancel" }).click();
    await page.reload();
    await page.waitForLoadState("networkidle");

    // The phase group (Gantt.tsx: "{tasks.length} tasks · {progressPct}%")
    // and the package-level rollup (ScheduleCards.tsx, same shape) — Swimming
    // Pool's weighted mean: (2*100 + 3*100 + 3*100) / 32 = 25%.
    await expect(page.getByText("1 tasks · 100%")).toBeVisible();
    await expect(page.getByText("13 tasks · 25%")).toBeVisible();
  });
});

test.describe("client: clicking a task bar is read-only", () => {
  test("toast, no dialog", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "client", "client-only journey");

    await page.goto(`/projects/${PROJECT}/schedule`);
    await page.waitForLoadState("networkidle");

    const bar = page.locator('[title^="Pool plumbing rough-in:"]');
    await expect(bar).toBeVisible();
    await bar.click(); // a real click — see the site journey's own comment above

    await expect(page.getByText("Pool plumbing rough-in: 0% complete")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pool plumbing rough-in" })).not.toBeVisible();
  });
});

test.describe("admin: a task beyond the 14-week default widens the viewport", () => {
  let createdTaskId: string | null = null;

  test.afterAll(async () => {
    if (!createdTaskId) return;
    const sql = dbConnect();
    try {
      await sql`delete from public.tasks where id = ${createdTaskId}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  test("viewport widens, the new task is visible", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "admin", "admin-only journey");

    await page.goto(`/projects/${PROJECT}/schedule`);
    await page.waitForLoadState("networkidle");

    // Week header markers ("W1", "W2", ...) — one per visible column. The
    // default viewport is 0-13 (14 columns); a task ending beyond that
    // widens `to` (features/schedule/service.ts's viewportWeeks) rather than
    // clipping it.
    const weekMarkers = page.getByText(/^W\d+$/);
    const before = await weekMarkers.count();
    expect(before).toBe(14);

    const stamp = Date.now().toString(36);
    const taskName = `E2E far-future task ${stamp}`;
    await page.getByRole("button", { name: "Add Task" }).first().click();
    await page.getByLabel("Task").fill(taskName);
    await page.getByLabel("Phase").selectOption({ label: "Deck finishes" });
    await page.getByLabel("Start Date").fill("2027-01-11");
    await page.getByLabel("Duration (weeks)").fill("2");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByText(taskName)).toBeVisible();

    const sql = dbConnect();
    try {
      const [row] = await sql`select id from public.tasks where name = ${taskName}`;
      createdTaskId = row?.id ?? null;
    } finally {
      await sql.end({ timeout: 5 });
    }
    expect(createdTaskId).not.toBeNull();

    const after = await weekMarkers.count();
    expect(after).toBeGreaterThan(before);
  });
});
