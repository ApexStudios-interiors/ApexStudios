import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";
import type { PostDailyUpdateInput } from "./schema";

/**
 * postDailyUpdateFor's attachment re-check, run against ROWS rather than
 * asserted call by call: the fake client below applies the query's own
 * filters (in / eq / is) to an in-memory attachments table, so each case
 * proves which existing attachment ids may — and may not — be posted with an
 * update. write.test.ts pins the exact filters; this pins what they mean.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  attachments: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
}));

/** select(…).in/eq/is chain over `rows`, resolving to the matching ids. */
function attachmentsQuery(rows: Row[]) {
  let matching = rows;
  const chain = {
    select: () => chain,
    in: (col: string, values: unknown[]) => {
      matching = matching.filter((r) => values.includes(r[col]));
      return chain;
    },
    eq: (col: string, value: unknown) => {
      matching = matching.filter((r) => r[col] === value);
      return chain;
    },
    is: (col: string, value: unknown) => {
      matching = matching.filter((r) => r[col] === value);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: matching.map((r) => ({ id: r.id })), error: null }),
  };
  return chain;
}

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) =>
      table === "attachments"
        ? attachmentsQuery(h.attachments)
        : {
            insert: async (row: Row) => {
              h.inserted.push(row);
              return { error: null };
            },
          },
  }),
}));

const { postDailyUpdateFor } = await import("./write");

const ME = "00000000-0000-4000-8000-0000000000d5";
const SOMEONE_ELSE = "00000000-0000-4000-8000-0000000000d2";
const PROJECT = "00000000-0000-4000-8000-0000000000c1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000c2";
const UPDATE_ID = "00000000-0000-4000-8000-0000000000b1";
const OTHER_UPDATE_ID = "00000000-0000-4000-8000-0000000000b2";

const session: Session = {
  userId: ME,
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Ravi",
  email: null,
  impersonating: null,
};

const INPUT: PostDailyUpdateInput = {
  id: UPDATE_ID,
  projectId: PROJECT,
  packageId: "00000000-0000-4000-8000-0000000000e1",
  updateDate: "2026-10-07",
  body: "Coat two done",
  attachmentIds: [],
};

/** A photo this session uploaded for this update — every field right. */
function photo(id: string, over: Row = {}): Row {
  return {
    id,
    entity_type: "daily_update",
    entity_id: UPDATE_ID,
    project_id: PROJECT,
    uploaded_by: ME,
    deleted_at: null,
    ...over,
  };
}

const GOOD = "00000000-0000-4000-8000-000000000a01";
const SUSPECT = "00000000-0000-4000-8000-000000000a02";
const REFUSED = "NOT_FOUND: one or more photos did not upload correctly — please retry them";

beforeEach(() => {
  h.attachments.length = 0;
  h.inserted.length = 0;
});

describe("postDailyUpdateFor — which attachments may be posted with an update", () => {
  it("accepts this session's own photos for this update and project", async () => {
    h.attachments.push(photo(GOOD), photo(SUSPECT));

    const result = await postDailyUpdateFor(session, { ...INPUT, attachmentIds: [GOOD, SUSPECT] });

    expect(result).toEqual({ id: UPDATE_ID });
    expect(h.inserted).toHaveLength(1);
  });

  it.each([
    ["filed under another project", { project_id: OTHER_PROJECT }],
    ["filed under another daily update", { entity_id: OTHER_UPDATE_ID }],
    ["uploaded by another user", { uploaded_by: SOMEONE_ELSE }],
    ["deleted", { deleted_at: "2026-10-07T08:00:00.000Z" }],
    ["attached to another kind of record", { entity_type: "approval" }],
  ])("refuses a photo %s, and posts nothing", async (_label, over) => {
    h.attachments.push(photo(GOOD), photo(SUSPECT, over));

    await expect(postDailyUpdateFor(session, { ...INPUT, attachmentIds: [GOOD, SUSPECT] })).rejects.toThrow(
      REFUSED
    );
    expect(h.inserted).toHaveLength(0);
  });

  it("refuses an attachment id that does not exist at all", async () => {
    h.attachments.push(photo(GOOD));

    await expect(postDailyUpdateFor(session, { ...INPUT, attachmentIds: [GOOD, SUSPECT] })).rejects.toThrow(
      REFUSED
    );
    expect(h.inserted).toHaveLength(0);
  });
});
