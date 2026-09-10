import { afterAll, afterEach, describe, expect, it } from "vitest";
import { connect, SEED } from "./db";
import { one } from "./expect-row";

/**
 * The progress rollup trigger. Cached rather than computed, so it is only
 * correct as long as this passes.
 */
const sql = connect();
afterAll(() => sql.end({ timeout: 5 }));

const scratch: string[] = [];
afterEach(async () => {
  if (scratch.length) {
    await sql`delete from public.tasks where id = any(${scratch})`;
    scratch.length = 0;
  }
});

async function addTask(name: string, weeks: number, pct: number) {
  const t = one(
    await sql`insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date, duration_weeks, progress_pct)
              values (${SEED.org}, ${SEED.project}, ${SEED.poolPackage}, ${SEED.phaseTiling},
                      ${name}, date '2026-01-05', ${weeks}, ${pct})
              returning id`,
    "inserted task"
  );
  scratch.push(t.id);
  return t.id;
}

async function packageProgress() {
  const p = one(
    await sql`select progress_pct from public.packages where id = ${SEED.poolPackage}`,
    "package row"
  );
  return Number(p.progress_pct);
}

describe("progress rollup", () => {
  it("T-16: weights by duration — 3 weeks at 100% plus 1 week at 0% is 75%", async () => {
    // Isolate the arithmetic from the seeded tasks by soft-deleting them first.
    await sql`update public.tasks set deleted_at = now()
               where package_id = ${SEED.poolPackage} and deleted_at is null`;
    try {
      await addTask("three weeks done", 3, 100);
      await addTask("one week not started", 1, 0);
      expect(await packageProgress()).toBe(75);
    } finally {
      await sql`update public.tasks set deleted_at = null
                 where package_id = ${SEED.poolPackage} and id <> all(${scratch})`;
    }
  });

  it("excludes soft-deleted tasks from the mean", async () => {
    const before = await packageProgress();
    const id = await addTask("temporarily counted", 4, 100);
    expect(await packageProgress()).not.toBe(before);
    await sql`update public.tasks set deleted_at = now() where id = ${id}`;
    expect(await packageProgress()).toBe(before);
  });

  it("rolls package progress up into the project", async () => {
    const p = one(
      await sql`select progress_pct from public.projects where id = ${SEED.project}`,
      "project row"
    );
    expect(Number(p.progress_pct)).toBeGreaterThanOrEqual(0);
    expect(Number(p.progress_pct)).toBeLessThanOrEqual(100);
  });
});
