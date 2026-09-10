import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { connect } from "./db";
import { one } from "./expect-row";

/**
 * The job queue's concurrency primitive. Build 06 depends on it, so it is tested
 * here, before anything is built on top.
 */
const sql = connect();
afterAll(() => sql.end({ timeout: 5 }));

describe("jobs", () => {
  beforeEach(async () => {
    await sql`delete from public.jobs where name like 'test.%'`;
  });

  it("T-21: two concurrent rpc_claim_jobs calls never return the same row", async () => {
    // One row, two claimants. Without `for update skip locked` both would get it
    // and the job would run twice — which is exactly what happens when two cron
    // ticks overlap.
    // Distinct idempotency_key per row is required, not cosmetic:
    // jobs_idem_uq is `unique nulls not distinct (name, idempotency_key)`, so
    // 20 rows sharing one name and a null key would collide with each other
    // before concurrency ever enters the picture.
    await sql`
      insert into public.jobs (name, idempotency_key, payload)
      select 'test.concurrent', gs::text, '{}'::jsonb from generate_series(1, 20) gs`;

    // Run the claims genuinely in parallel on separate connections.
    const a = connect();
    const b = connect();
    try {
      const [ra, rb] = await Promise.all([
        a`select id from public.rpc_claim_jobs(array['test.concurrent'], 20)`,
        b`select id from public.rpc_claim_jobs(array['test.concurrent'], 20)`,
      ]);
      const ids = [...ra.map((r) => r.id), ...rb.map((r) => r.id)];
      expect(new Set(ids).size, "a job was claimed twice").toBe(ids.length);
      expect(ids.length).toBe(20);
    } finally {
      await a.end({ timeout: 5 });
      await b.end({ timeout: 5 });
    }
  });

  it("passing once proves nothing: the claim holds over repeated races", async () => {
    for (let round = 0; round < 5; round++) {
      await sql`delete from public.jobs where name = 'test.loop'`;
      await sql`
        insert into public.jobs (name, idempotency_key, payload)
        select 'test.loop', gs::text, '{}'::jsonb from generate_series(1, 10) gs`;
      const a = connect();
      const b = connect();
      try {
        const [ra, rb] = await Promise.all([
          a`select id from public.rpc_claim_jobs(array['test.loop'], 10)`,
          b`select id from public.rpc_claim_jobs(array['test.loop'], 10)`,
        ]);
        const ids = [...ra.map((r) => r.id), ...rb.map((r) => r.id)];
        expect(new Set(ids).size, `round ${round}: a job was claimed twice`).toBe(ids.length);
      } finally {
        await a.end({ timeout: 5 });
        await b.end({ timeout: 5 });
      }
    }
  });

  it("T-24: enqueuing the same (name, idempotency_key) twice creates one row", async () => {
    await sql`
      insert into public.jobs (name, idempotency_key, payload)
      values ('test.idem', 'attachment-42', '{}'::jsonb)`;
    await expect(
      sql`insert into public.jobs (name, idempotency_key, payload)
          values ('test.idem', 'attachment-42', '{}'::jsonb)`
    ).rejects.toThrow(/jobs_idem_uq|duplicate key/i);

    const rows = await sql`select id from public.jobs where name = 'test.idem'`;
    expect(rows.length).toBe(1);
  });

  it("nulls not distinct: two un-keyed jobs of the same name also collide", async () => {
    await sql`insert into public.jobs (name, payload) values ('test.nullkey', '{}'::jsonb)`;
    await expect(
      sql`insert into public.jobs (name, payload) values ('test.nullkey', '{}'::jsonb)`
    ).rejects.toThrow(/jobs_idem_uq|duplicate key/i);
  });

  it("rpc_finish_job backs off exponentially and goes terminal at max_attempts", async () => {
    const job = one(
      await sql`insert into public.jobs (name, payload, attempts, max_attempts)
                values ('test.backoff', '{}'::jsonb, 2, 5) returning id`,
      "inserted job"
    );
    await sql`select public.rpc_finish_job(${job.id}, false, 'boom')`;
    const after = one(
      await sql`select status, last_error, run_after > now() as deferred
                  from public.jobs where id = ${job.id}`,
      "job after failure"
    );
    expect(after.status).toBe("pending");
    expect(after.deferred).toBe(true);
    expect(after.last_error).toBe("boom");

    const terminal = one(
      await sql`insert into public.jobs (name, payload, attempts, max_attempts)
                values ('test.terminal', '{}'::jsonb, 5, 5) returning id`,
      "inserted job at max attempts"
    );
    await sql`select public.rpc_finish_job(${terminal.id}, false, 'gave up')`;
    const done = one(
      await sql`select status, finished_at from public.jobs where id = ${terminal.id}`,
      "job after the last attempt"
    );
    expect(done.status).toBe("failed");
    expect(done.finished_at).not.toBeNull();
  });
});
