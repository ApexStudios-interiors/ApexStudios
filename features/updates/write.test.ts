import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { PostDailyUpdateInput } from "./schema";

/**
 * postDailyUpdateFor / editDailyUpdateFor — the shared write path for the web
 * actions and the mobile API — with the RLS-scoped client faked. What they
 * pin down: the attachment-ownership re-check (every filter it always had),
 * the exact row inserted, the edit sending `body` + the caller's
 * `updated_by` and nothing else, the results, and every database error
 * passed through unchanged for the caller's mapDomainError.
 *
 * Who may post (admin/site) is the caller's guard (siteAction, and
 * requireRole on the mobile route — lib/rbac/permissions.test.ts covers the
 * action's list) and du_insert's; who may edit, and until when, is
 * du_update_author's. Those are faked here as the errors / empty results the
 * database gives; the policies and triggers themselves are tested against
 * Postgres in tests/integration/files-and-jobs.test.ts.
 */

type Result = { data?: unknown; error: { message: string; code?: string } | null };

/**
 * A stand-in for one supabase-js query: every builder method records its
 * call and returns the chain; awaiting the chain resolves to `result`.
 */
function query(result: Result) {
  const calls: [string, ...unknown[]][] = [];
  const chain: object = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push([prop, ...args]);
          return chain;
        };
      },
    }
  );
  return { chain, calls };
}

const h = vi.hoisted(() => ({
  queries: [] as { table: string; chain: object; calls: [string, ...unknown[]][] }[],
  results: {} as Record<string, Result[]>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const next = h.results[table]?.shift();
      if (!next) throw new Error(`unexpected query on ${table}`);
      const q = query(next);
      h.queries.push({ table, ...q });
      return q.chain;
    },
  }),
}));

const { postDailyUpdateFor, editDailyUpdateFor } = await import("./write");

const UPDATE_ID = "00000000-0000-4000-8000-0000000000b1";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";
const PACKAGE_ID = "00000000-0000-4000-8000-0000000000e1";
const ATT_1 = "00000000-0000-4000-8000-000000000a01";
const ATT_2 = "00000000-0000-4000-8000-000000000a02";

function sessionAs(role: Session["role"], userId = "00000000-0000-4000-8000-0000000000d5"): Session {
  return {
    userId,
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const INPUT: PostDailyUpdateInput = {
  id: UPDATE_ID,
  projectId: PROJECT_ID,
  packageId: PACKAGE_ID,
  updateDate: "2026-10-07",
  body: "Waterproofing coat two done",
  attachmentIds: [],
};

function callsOn(table: string) {
  const q = h.queries.find((x) => x.table === table);
  if (!q) throw new Error(`no query on ${table}`);
  return q.calls;
}

beforeEach(() => {
  h.queries.length = 0;
  h.results = {};
});

describe("postDailyUpdateFor", () => {
  it.each(["admin", "site"] as const)(
    "inserts the update for %s with the session as author and returns its id",
    async (role) => {
      const session = sessionAs(role);
      h.results.daily_updates = [{ error: null }];

      const result = await postDailyUpdateFor(session, INPUT);

      expect(result).toEqual({ id: UPDATE_ID });
      expect(callsOn("daily_updates")).toEqual([
        [
          "insert",
          {
            id: UPDATE_ID,
            org_id: session.orgId,
            project_id: PROJECT_ID,
            package_id: PACKAGE_ID,
            update_date: "2026-10-07",
            body: "Waterproofing coat two done",
            author_id: session.userId,
            created_by: session.userId,
          },
        ],
      ]);
    }
  );

  it("uses the client-generated id as the row's id — the one its photos were confirmed against", async () => {
    h.results.daily_updates = [{ error: null }];

    await postDailyUpdateFor(sessionAs("site"), INPUT);

    expect((callsOn("daily_updates")[0]?.[1] as { id: string }).id).toBe(UPDATE_ID);
  });

  it("does not look at attachments when there are none", async () => {
    h.results.daily_updates = [{ error: null }];

    await postDailyUpdateFor(sessionAs("site"), INPUT);

    expect(h.queries.map((q) => q.table)).toEqual(["daily_updates"]);
  });

  it("re-checks each attachment is this session's own upload for this project and update, then inserts", async () => {
    const session = sessionAs("site");
    h.results.attachments = [{ data: [{ id: ATT_1 }, { id: ATT_2 }], error: null }];
    h.results.daily_updates = [{ error: null }];

    const result = await postDailyUpdateFor(session, { ...INPUT, attachmentIds: [ATT_1, ATT_2] });

    expect(result).toEqual({ id: UPDATE_ID });
    expect(callsOn("attachments")).toEqual([
      ["select", "id"],
      ["in", "id", [ATT_1, ATT_2]],
      ["eq", "entity_type", "daily_update"],
      ["eq", "entity_id", UPDATE_ID],
      ["eq", "project_id", PROJECT_ID],
      ["eq", "uploaded_by", session.userId],
      ["is", "deleted_at", null],
    ]);
    expect(h.queries.map((q) => q.table)).toEqual(["attachments", "daily_updates"]);
  });

  it("refuses, before inserting, when any attachment is not one of those uploads", async () => {
    h.results.attachments = [{ data: [{ id: ATT_1 }], error: null }];

    await expect(
      postDailyUpdateFor(sessionAs("site"), { ...INPUT, attachmentIds: [ATT_1, ATT_2] })
    ).rejects.toThrow("NOT_FOUND: one or more photos did not upload correctly — please retry them");
    expect(h.queries.map((q) => q.table)).toEqual(["attachments"]);
  });

  it("throws the attachment lookup's own error unchanged", async () => {
    h.results.attachments = [{ data: null, error: { message: "attachments lookup failed" } }];

    await expect(postDailyUpdateFor(sessionAs("site"), { ...INPUT, attachmentIds: [ATT_1] })).rejects.toThrow(
      "attachments lookup failed"
    );
    expect(h.queries.map((q) => q.table)).toEqual(["attachments"]);
  });

  it("throws a package-not-in-project refusal unchanged, so it still maps to NOT_FOUND", async () => {
    h.results.daily_updates = [
      { error: { message: `NOT_FOUND: package ${PACKAGE_ID} does not exist in this project` } },
    ];

    await expect(postDailyUpdateFor(sessionAs("site"), INPUT)).rejects.toThrow(
      `NOT_FOUND: package ${PACKAGE_ID} does not exist in this project`
    );
  });

  it("answers a second post of the same id — a retry — with ILLEGAL_TRANSITION, not a second update", async () => {
    h.results.daily_updates = [
      {
        error: {
          code: "23505",
          message: 'duplicate key value violates unique constraint "daily_updates_pkey"',
        },
      },
    ];

    await expect(postDailyUpdateFor(sessionAs("site"), INPUT)).rejects.toThrow(
      "ILLEGAL_TRANSITION: this daily update has already been posted"
    );
  });

  it("throws any other unique violation unchanged", async () => {
    const other = 'duplicate key value violates unique constraint "some_other_key"';
    h.results.daily_updates = [{ error: { code: "23505", message: other } }];

    await expect(postDailyUpdateFor(sessionAs("site"), INPUT)).rejects.toThrow(other);
  });

  it("throws du_insert's refusal (a client, or a non-member) unchanged", async () => {
    const rls = 'new row violates row-level security policy for table "daily_updates"';
    h.results.daily_updates = [{ error: { message: rls } }];

    await expect(postDailyUpdateFor(sessionAs("client"), INPUT)).rejects.toThrow(rls);
  });
});

describe("editDailyUpdateFor", () => {
  it("updates the body as the caller and returns the id and project", async () => {
    const session = sessionAs("site");
    h.results.daily_updates = [{ data: { id: UPDATE_ID, project_id: PROJECT_ID }, error: null }];

    const result = await editDailyUpdateFor(session, { id: UPDATE_ID, body: "Coat two, not one" });

    expect(result).toEqual({ id: UPDATE_ID, projectId: PROJECT_ID });
    expect(callsOn("daily_updates")).toEqual([
      ["update", { body: "Coat two, not one", updated_by: session.userId }],
      ["eq", "id", UPDATE_ID],
      ["select", "id, project_id"],
      ["maybeSingle"],
    ]);
  });

  it("works the same for an admin editing their own update", async () => {
    const session = sessionAs("admin", "00000000-0000-4000-8000-0000000000d2");
    h.results.daily_updates = [{ data: { id: UPDATE_ID, project_id: PROJECT_ID }, error: null }];

    await editDailyUpdateFor(session, { id: UPDATE_ID, body: "Edited" });

    expect(callsOn("daily_updates")[0]).toEqual(["update", { body: "Edited", updated_by: session.userId }]);
  });

  it("sends only body and updated_by, whatever else the input carries", async () => {
    h.results.daily_updates = [{ data: { id: UPDATE_ID, project_id: PROJECT_ID }, error: null }];
    const crafted = {
      id: UPDATE_ID,
      body: "Edited",
      projectId: "00000000-0000-4000-8000-0000000000c2",
      packageId: "00000000-0000-4000-8000-0000000000e7",
      updateDate: "2026-01-01",
      authorId: "00000000-0000-4000-8000-0000000000d2",
    };

    await editDailyUpdateFor(sessionAs("site"), crafted);

    const sent = callsOn("daily_updates")[0]?.[1];
    expect(Object.keys(sent as object).sort()).toEqual(["body", "updated_by"]);
  });

  it.each([
    ["a non-author", sessionAs("site", "00000000-0000-4000-8000-0000000000d9")],
    ["the author after 24 hours", sessionAs("site")],
  ])("refuses %s — du_update_author returns no row — with ILLEGAL_TRANSITION", async (_label, session) => {
    h.results.daily_updates = [{ data: null, error: null }];

    await expect(editDailyUpdateFor(session, { id: UPDATE_ID, body: "Too late" })).rejects.toThrow(
      "ILLEGAL_TRANSITION: this update can no longer be edited"
    );
  });

  it("throws a database error unchanged", async () => {
    h.results.daily_updates = [
      { data: null, error: { message: "FORBIDDEN: only the body of a daily update can be edited" } },
    ];

    await expect(editDailyUpdateFor(sessionAs("site"), { id: UPDATE_ID, body: "x" })).rejects.toThrow(
      "FORBIDDEN: only the body of a daily update can be edited"
    );
  });
});
