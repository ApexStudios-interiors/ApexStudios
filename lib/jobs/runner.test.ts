import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/jobs/runner.ts against a fake service_role client: claim → dispatch →
 * finish, the deadline guard, self-enqueue idempotency, and reap (APX-23,
 * APX-54). The SQL halves (rpc_claim_jobs / rpc_finish_job / rpc_reap_jobs)
 * are tested against a real database in tests/integration/jobs.test.ts.
 */

type Job = { id: string; name: string; payload: unknown; attempts: number };

const h = vi.hoisted(() => ({
  queue: [] as Job[],
  claimCalls: [] as { p_names: string[]; p_limit: number }[],
  finishCalls: [] as { p_id: string; p_ok: boolean; p_error: string | null; p_attempt: number }[],
  finishResult: true as boolean,
  finishError: null as { message: string } | null,
  claimError: null as { message: string } | null,
  inserts: [] as unknown[],
  insertError: null as { code?: string; message: string } | null,
  reapResult: [{ requeued: 0, failed: 0 }] as { requeued: number; failed: number }[] | null,
  reapError: null as { message: string } | null,
  handlers: {} as Record<string, (payload: unknown, id: string) => Promise<void>>,
}));

vi.mock("server-only", () => ({}));
vi.mock("./registry", () => ({ JOB_REGISTRY: h.handlers }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "rpc_claim_jobs") {
        h.claimCalls.push(args as { p_names: string[]; p_limit: number });
        if (h.claimError) return { data: null, error: h.claimError };
        const names = args.p_names as string[];
        const limit = args.p_limit as number;
        const picked = h.queue.filter((j) => names.includes(j.name)).slice(0, limit);
        h.queue = h.queue.filter((j) => !picked.includes(j));
        return { data: picked, error: null };
      }
      if (name === "rpc_finish_job") {
        h.finishCalls.push(args as (typeof h.finishCalls)[number]);
        return h.finishError ? { data: null, error: h.finishError } : { data: h.finishResult, error: null };
      }
      if (name === "rpc_reap_jobs") {
        return h.reapError ? { data: null, error: h.reapError } : { data: h.reapResult, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from: (table: string) => {
      if (table !== "jobs") throw new Error(`unexpected table ${table}`);
      return {
        insert: async (row: unknown) => {
          h.inserts.push(row);
          return { error: h.insertError };
        },
      };
    },
  }),
}));

const { drain, reap, selfEnqueueAndDrain } = await import("./runner");

function job(id: string, name = "attachment.thumbnail", attempts = 1): Job {
  return { id, name, payload: { id }, attempts };
}

beforeEach(() => {
  h.queue = [];
  h.claimCalls.length = 0;
  h.finishCalls.length = 0;
  h.finishResult = true;
  h.finishError = null;
  h.claimError = null;
  h.inserts.length = 0;
  h.insertError = null;
  h.reapResult = [{ requeued: 0, failed: 0 }];
  h.reapError = null;
  for (const k of Object.keys(h.handlers)) delete h.handlers[k];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("drain", () => {
  it("runs each claimed job and finishes it with the attempt it claimed", async () => {
    const ran: string[] = [];
    h.handlers["attachment.thumbnail"] = async (_p, id) => {
      ran.push(id);
    };
    h.queue = [job("a", "attachment.thumbnail", 1), job("b", "attachment.thumbnail", 3)];

    const summary = await drain(["attachment.thumbnail"]);

    expect(ran).toEqual(["a", "b"]);
    expect(summary).toMatchObject({ claimed: 2, succeeded: 2, failed: 0 });
    expect(h.finishCalls).toEqual([
      { p_id: "a", p_ok: true, p_error: null, p_attempt: 1 },
      { p_id: "b", p_ok: true, p_error: null, p_attempt: 3 },
    ]);
  });

  it("records a handler's error message as the failure, and carries on with the next job", async () => {
    h.handlers["bill.pdf"] = async (_p, id) => {
      if (id === "bad") throw new Error("render failed");
    };
    h.queue = [job("bad", "bill.pdf"), job("good", "bill.pdf")];

    const summary = await drain(["bill.pdf"]);

    expect(summary).toMatchObject({ claimed: 2, succeeded: 1, failed: 1 });
    expect(h.finishCalls[0]).toMatchObject({ p_id: "bad", p_ok: false, p_error: "render failed" });
    expect(h.finishCalls[1]).toMatchObject({ p_id: "good", p_ok: true });
  });

  it("a job with no registered handler fails rather than crashing the drain", async () => {
    h.queue = [job("x", "nobody.knows")];
    const summary = await drain(["nobody.knows"]);
    expect(summary.failed).toBe(1);
    expect(h.finishCalls[0]?.p_error).toMatch(/no handler registered/);
  });

  it("a non-Error throw is still recorded as a message", async () => {
    h.handlers["bill.pdf"] = async () => {
      throw "plain string";
    };
    h.queue = [job("s", "bill.pdf")];
    await drain(["bill.pdf"]);
    expect(h.finishCalls[0]?.p_error).toBe("plain string");
  });

  it("a refused finish (the row was reaped and re-claimed) is logged, not thrown", async () => {
    h.handlers["bill.pdf"] = async () => {};
    h.finishResult = false;
    h.queue = [job("late", "bill.pdf", 2)];
    await expect(drain(["bill.pdf"])).resolves.toMatchObject({ succeeded: 1 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("ignored"));
  });

  it("an error recording a SUCCESS is thrown, never re-recorded as the job failing", async () => {
    h.handlers["bill.pdf"] = async () => {};
    h.finishError = { message: "db down" };
    h.queue = [job("ok", "bill.pdf")];
    await expect(drain(["bill.pdf"])).rejects.toThrow("db down");
    expect(h.finishCalls).toHaveLength(1);
    expect(h.finishCalls[0]?.p_ok).toBe(true);
  });

  it("keeps claiming full batches until the queue is empty", async () => {
    h.handlers["attachment.thumbnail"] = async () => {};
    h.queue = Array.from({ length: 12 }, (_, i) => job(`j${i}`));
    const summary = await drain(["attachment.thumbnail"], { limit: 5 });
    expect(summary.claimed).toBe(12);
    expect(h.claimCalls).toHaveLength(3); // 5, 5, then 2 (< limit: stop)
  });

  it("stops claiming once the deadline has passed", async () => {
    h.handlers["attachment.thumbnail"] = async () => {};
    h.queue = Array.from({ length: 10 }, (_, i) => job(`j${i}`));
    const summary = await drain(["attachment.thumbnail"], { limit: 5, deadlineMs: 0 });
    expect(summary.claimed).toBe(0);
    expect(h.claimCalls).toHaveLength(0);
  });

  it("throws a claim error", async () => {
    h.claimError = { message: "claim failed" };
    await expect(drain(["bill.pdf"])).rejects.toThrow("claim failed");
  });
});

describe("selfEnqueueAndDrain", () => {
  it("inserts the scheduled job with its period key, then drains that name only", async () => {
    h.handlers["backup.verify"] = async () => {};
    await selfEnqueueAndDrain("backup.verify", {}, "2026-11-24");
    expect(h.inserts).toEqual([{ name: "backup.verify", payload: {}, idempotency_key: "2026-11-24" }]);
    expect(h.claimCalls[0]).toMatchObject({ p_names: ["backup.verify"], p_limit: 1 });
  });

  it("a duplicate for the same period (23505) is the expected no-op, not an error", async () => {
    h.insertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    await expect(selfEnqueueAndDrain("backup.verify", {}, "2026-11-24")).resolves.toMatchObject({
      claimed: 0,
    });
  });

  it("any other insert error is thrown", async () => {
    h.insertError = { code: "42501", message: "permission denied" };
    await expect(selfEnqueueAndDrain("backup.verify", {}, "2026-11-24")).rejects.toThrow("permission denied");
  });
});

describe("reap (APX-23)", () => {
  it("returns what rpc_reap_jobs requeued and failed", async () => {
    h.reapResult = [{ requeued: 2, failed: 0 }];
    await expect(reap()).resolves.toEqual({ requeued: 2, failed: 0 });
  });

  it("logs loudly when a job timed out on every attempt and went terminal", async () => {
    h.reapResult = [{ requeued: 0, failed: 1 }];
    await expect(reap()).resolves.toEqual({ requeued: 0, failed: 1 });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("now failed"));
  });

  it("an empty result is zero, not a crash", async () => {
    h.reapResult = [];
    await expect(reap()).resolves.toEqual({ requeued: 0, failed: 0 });
  });

  it("throws an RPC error", async () => {
    h.reapError = { message: "reap failed" };
    await expect(reap()).rejects.toThrow("reap failed");
  });
});
