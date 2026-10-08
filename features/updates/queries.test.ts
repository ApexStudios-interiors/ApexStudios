import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * getUpdatesForProject's `limit`: a caller that shows only a few (Package
 * Details' latest five) reads only those — fewer rows, author names and photo
 * links — newest first exactly as the default page, which stays 20.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  updates: [] as Row[],
  limits: [] as number[],
  attachmentIds: [] as unknown[][],
  presign: vi.fn(async (key: string) => `https://signed/${key}`),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/r2/presign", () => ({ presignGet: h.presign }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let rows: Row[] =
        table === "daily_updates"
          ? [...h.updates]
          : table === "attachments"
            ? h.updates.map((u) => ({
                id: `att-${u.id}`,
                entity_id: u.id,
                mime_type: "image/jpeg",
                r2_key: `k/${u.id}`,
                thumb_r2_key: null,
              }))
            : [];
      const chain = {
        select: () => chain,
        eq: (col: string, v: unknown) => (
          (rows = rows.filter((r) => r[col] === undefined || r[col] === v)),
          chain
        ),
        is: () => chain,
        in: (col: string, vs: unknown[]) => {
          if (table === "attachments") h.attachmentIds.push(vs);
          rows = rows.filter((r) => r[col] === undefined || vs.includes(r[col]));
          return chain;
        },
        order: () => chain,
        limit: (n: number) => {
          h.limits.push(n);
          rows = rows.slice(0, n);
          return chain;
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      };
      return chain;
    },
  }),
}));

const { getUpdatesForProject } = await import("./queries");

const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const PKG = "00000000-0000-4000-8000-0000000000e1";

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d1",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Test User",
  email: null,
  impersonating: null,
};

beforeEach(() => {
  h.limits.length = 0;
  h.attachmentIds.length = 0;
  h.presign.mockClear();
  // Newest first, as the query orders them.
  h.updates = Array.from({ length: 30 }, (_, i) => ({
    id: `u${String(i).padStart(2, "0")}`,
    project_id: PROJECT,
    package_id: PKG,
    update_date: "2026-10-01",
    body: "b",
    author_id: "a1",
    created_at: `2026-10-01T10:${String(59 - i).padStart(2, "0")}:00Z`,
  }));
});

describe("getUpdatesForProject — limit", () => {
  it("without a limit: the default page of 20 (one extra row read to know there is more)", async () => {
    const page = await getUpdatesForProject(SESSION, PROJECT, { packageId: PKG });

    expect(h.limits).toEqual([21]);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it("with limit 5: only five read, named and photo-signed — the same first five", async () => {
    const full = await getUpdatesForProject(SESSION, PROJECT, { packageId: PKG });
    h.limits.length = 0;
    h.attachmentIds.length = 0;
    h.presign.mockClear();

    const five = await getUpdatesForProject(SESSION, PROJECT, { packageId: PKG, limit: 5 });

    expect(h.limits).toEqual([6]);
    expect(five.items).toEqual(full.items.slice(0, 5));
    expect(h.attachmentIds).toEqual([["u00", "u01", "u02", "u03", "u04"]]);
    expect(h.presign).toHaveBeenCalledTimes(10); // thumb + download for each of five photos
  });

  it("a limit above the default page is capped at it", async () => {
    await getUpdatesForProject(SESSION, PROJECT, { limit: 500 });

    expect(h.limits).toEqual([21]);
  });

  it("a limit of 0 or less means the default", async () => {
    await getUpdatesForProject(SESSION, PROJECT, { limit: 0 });

    expect(h.limits).toEqual([21]);
  });
});
