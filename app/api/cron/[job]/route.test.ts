import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The cron route is claim/dispatch/record only (AGENTS.md background job rule
 * 3): auth first, a known job name, then one call into lib/jobs/runner.
 */

const SECRET = "c".repeat(44);

const h = vi.hoisted(() => ({
  drain: vi.fn(),
  reap: vi.fn(),
  selfEnqueueAndDrain: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "c".repeat(44) } }));
vi.mock("@/lib/jobs/runner", () => ({
  drain: h.drain,
  reap: h.reap,
  selfEnqueueAndDrain: h.selfEnqueueAndDrain,
}));
vi.mock("@/lib/jobs/registry", () => ({ DRAIN_JOB_NAMES: ["attachment.thumbnail", "bill.pdf"] }));

const { GET } = await import("./route");

const summary = { claimed: 1, succeeded: 1, failed: 0, durationMs: 5 };

function call(job: string, auth: string | null = `Bearer ${SECRET}`) {
  const headers = new Headers();
  if (auth !== null) headers.set("authorization", auth);
  return GET(new NextRequest(`https://apex.example.com/api/cron/${job}`, { headers }), {
    params: Promise.resolve({ job }),
  });
}

beforeEach(() => {
  h.drain.mockReset().mockResolvedValue(summary);
  h.reap.mockReset().mockResolvedValue({ requeued: 1, failed: 2 });
  h.selfEnqueueAndDrain.mockReset().mockResolvedValue(summary);
});

describe("GET /api/cron/[job]", () => {
  it.each([null, "Bearer wrong", SECRET, `bearer ${SECRET}`])("401s for authorization %s", async (auth) => {
    const res = await call("jobs.drain", auth);
    expect(res.status).toBe(401);
    expect(h.drain).not.toHaveBeenCalled();
  });

  it("checks auth before the job name: an unknown job without a secret is 401, not 404", async () => {
    expect((await call("nope", null)).status).toBe(401);
  });

  it("404s an unknown job", async () => {
    const res = await call("rm -rf");
    expect(res.status).toBe(404);
  });

  it("jobs.drain drains every drain-listed name", async () => {
    const res = await call("jobs.drain");
    expect(res.status).toBe(200);
    expect(h.drain).toHaveBeenCalledWith(["attachment.thumbnail", "bill.pdf"]);
    expect(await res.json()).toEqual(summary);
  });

  it("jobs.reap reaps and reports both counts", async () => {
    const res = await call("jobs.reap");
    expect(await res.json()).toEqual({ requeued: 1, failed: 2 });
  });

  it.each(["inventory.reconcile", "backup.verify"])("%s self-enqueues for today's UTC date", async (job) => {
    await call(job);
    expect(h.selfEnqueueAndDrain).toHaveBeenCalledWith(job, {}, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
  });

  it("weekly.maintenance runs the sweep and the archive under one ISO-week key, and sums them", async () => {
    const res = await call("weekly.maintenance");
    expect(h.selfEnqueueAndDrain).toHaveBeenCalledTimes(2);
    const [sweepCall, archiveCall] = h.selfEnqueueAndDrain.mock.calls;
    expect(sweepCall?.[0]).toBe("attachment.orphan_sweep");
    expect(archiveCall?.[0]).toBe("project.archive");
    expect(sweepCall?.[2]).toMatch(/^\d{4}-W\d{2}$/);
    expect(archiveCall?.[2]).toBe(sweepCall?.[2]);
    expect(await res.json()).toEqual({ claimed: 2, succeeded: 2, failed: 0, durationMs: 10 });
  });
});
