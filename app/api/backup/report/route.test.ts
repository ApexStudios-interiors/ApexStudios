import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * POST /api/backup/report — backup-nightly.yml's outcome, recorded as one
 * `backup.nightly` jobs row per UTC day. Bearer CRON_SECRET or 401; a bad
 * body is 400; a second report the same day updates the same row rather than
 * piling up; a database error is a 500, so the workflow's "require exactly
 * 200" step goes red.
 */

type Result = { data: unknown; error: { message: string } | null };

const SECRET = "x".repeat(44);

const h = vi.hoisted(() => ({
  existing: { data: null, error: null } as Result,
  write: { data: null, error: null } as Result,
  selectFilters: [] as [string, unknown][],
  inserts: [] as unknown[],
  updates: [] as { patch: unknown; id: unknown }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "x".repeat(44) } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("jobs");
      return {
        select: () => {
          const chain = {
            eq: (col: string, val: unknown) => {
              h.selectFilters.push([col, val]);
              return chain;
            },
            maybeSingle: async () => h.existing,
          };
          return chain;
        },
        insert: async (row: unknown) => {
          h.inserts.push(row);
          return h.write;
        },
        update: (patch: unknown) => ({
          eq: async (_col: string, id: unknown) => {
            h.updates.push({ patch, id });
            return h.write;
          },
        }),
      };
    },
  }),
}));

const { POST } = await import("./route");

function request(body: unknown, auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (auth !== null) headers.set("authorization", auth);
  return new NextRequest("http://localhost/api/backup/report", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const TODAY = new Date().toISOString().slice(0, 10);

beforeEach(() => {
  h.existing = { data: null, error: null };
  h.write = { data: null, error: null };
  h.selectFilters.length = 0;
  h.inserts.length = 0;
  h.updates.length = 0;
});

describe("POST /api/backup/report", () => {
  it("401s without a bearer token", async () => {
    const res = await POST(request({ ok: true }, null));
    expect(res.status).toBe(401);
    expect(h.inserts).toHaveLength(0);
  });

  it("401s with the wrong bearer token", async () => {
    const res = await POST(request({ ok: true }, "Bearer not-the-secret"));
    expect(res.status).toBe(401);
    expect(h.inserts).toHaveLength(0);
  });

  it.each([["not json"], [{ ok: "yes" }], [{}]])("400s on an invalid body (%j)", async (body) => {
    const res = await POST(request(body));
    expect(res.status).toBe(400);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toHaveLength(0);
  });

  it("inserts today's backup.nightly row on the first report", async () => {
    const res = await POST(request({ ok: true, key: `pg_dump/${TODAY}.sql.gz` }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(h.selectFilters).toEqual([
      ["name", "backup.nightly"],
      ["idempotency_key", TODAY],
    ]);
    expect(h.inserts).toHaveLength(1);
    expect(h.inserts[0]).toMatchObject({
      name: "backup.nightly",
      idempotency_key: TODAY,
      status: "succeeded",
      last_error: null,
      payload: { key: `pg_dump/${TODAY}.sql.gz` },
    });
    expect(h.updates).toHaveLength(0);
  });

  it("updates the same row on a second report the same day", async () => {
    h.existing = { data: { id: "job-1" }, error: null };
    const res = await POST(request({ ok: true }));
    expect(res.status).toBe(200);
    expect(h.inserts).toHaveLength(0);
    expect(h.updates).toEqual([
      { patch: expect.objectContaining({ status: "succeeded", last_error: null }), id: "job-1" },
    ]);
  });

  it("records a failure as failed, with its error", async () => {
    const res = await POST(request({ ok: false, error: "upload failed" }));
    expect(res.status).toBe(200);
    expect(h.inserts[0]).toMatchObject({ status: "failed", last_error: "upload failed" });
  });

  it("500s when the lookup fails", async () => {
    h.existing = { data: null, error: { message: "db down" } };
    const res = await POST(request({ ok: true }));
    expect(res.status).toBe(500);
    expect(h.inserts).toHaveLength(0);
  });

  it("500s when the write fails", async () => {
    h.write = { data: null, error: { message: "insert refused" } };
    const res = await POST(request({ ok: true }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "insert refused" });
  });
});
