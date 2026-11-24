import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * attachment.thumbnail with every collaborator faked: the service_role
 * client, R2 (HeadObject via lib/r2/head, Get/Put via the shared client) and
 * sharp. Pins the idempotency rule (AGENTS.md background job rule 1) — an
 * already-rendered thumbnail whose object really exists is not re-rendered —
 * and that a failure anywhere throws, which is what lands the job in `failed`.
 */

type Result = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  select: { data: null, error: null } as Result,
  update: { data: null, error: null } as Result,
  updates: [] as { patch: unknown; eq: [string, unknown][] }[],
  send: vi.fn(),
  headObject: vi.fn(),
  sharp: vi.fn(),
  toBuffer: vi.fn(),
  resize: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { R2_BUCKET: "app-bucket" } }));
vi.mock("@/lib/r2/client", () => ({ r2Client: () => ({ send: h.send }) }));
vi.mock("@/lib/r2/head", () => ({ headObject: h.headObject }));
vi.mock("sharp", () => ({ default: h.sharp }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("attachments");
      return {
        select: () => {
          const chain = {
            eq: () => chain,
            maybeSingle: async () => h.select,
          };
          return chain;
        },
        update: (patch: unknown) => {
          const entry = { patch, eq: [] as [string, unknown][] };
          h.updates.push(entry);
          const chain = {
            eq: (col: string, val: unknown) => {
              entry.eq.push([col, val]);
              return chain;
            },
            then: (resolve: (r: Result) => unknown) => resolve(h.update),
          };
          return chain;
        },
      };
    },
  }),
}));

const { thumbnailAttachment } = await import("./attachment.thumbnail");

const ID = "00000000-0000-4000-8000-000000000a01";
const KEY = "org/o/project/p/daily_update/d/u-photo.jpg";

beforeEach(() => {
  h.select = {
    data: { id: ID, r2_key: KEY, mime_type: "image/jpeg", thumb_r2_key: null },
    error: null,
  };
  h.update = { data: null, error: null };
  h.updates.length = 0;
  h.send.mockReset();
  h.send.mockImplementation(async (cmd: { constructor: { name: string } }) => {
    if (cmd.constructor.name === "GetObjectCommand") {
      return { Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } };
    }
    return {};
  });
  h.headObject.mockReset();
  h.toBuffer.mockReset();
  h.toBuffer.mockResolvedValue(Buffer.from("thumb"));
  h.resize.mockReset();
  h.sharp.mockReset();
  h.sharp.mockImplementation(() => {
    const chain = {
      resize: (opts: unknown) => {
        h.resize(opts);
        return chain;
      },
      jpeg: () => chain,
      toBuffer: h.toBuffer,
    };
    return chain;
  });
});

function sentCommands(): { name: string; input: Record<string, unknown> }[] {
  return h.send.mock.calls.map(([cmd]) => {
    const c = cmd as { constructor: { name: string }; input: Record<string, unknown> };
    return { name: c.constructor.name, input: c.input };
  });
}

describe("attachment.thumbnail", () => {
  it("throws when the payload has no attachmentId", async () => {
    await expect(thumbnailAttachment({})).rejects.toThrow(/missing attachmentId/);
    expect(h.send).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND for an attachment that does not exist", async () => {
    h.select = { data: null, error: null };
    await expect(thumbnailAttachment({ attachmentId: ID })).rejects.toThrow(/^NOT_FOUND/);
  });

  it("throws the database error when the read fails", async () => {
    h.select = { data: null, error: { message: "db down" } };
    await expect(thumbnailAttachment({ attachmentId: ID })).rejects.toThrow("db down");
  });

  it("does nothing for a non-image (a PDF has no thumbnail)", async () => {
    h.select = {
      data: { id: ID, r2_key: KEY, mime_type: "application/pdf", thumb_r2_key: null },
      error: null,
    };
    await thumbnailAttachment({ attachmentId: ID });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.headObject).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("is a no-op when the thumbnail is recorded and its object really exists", async () => {
    h.select = {
      data: { id: ID, r2_key: KEY, mime_type: "image/jpeg", thumb_r2_key: `thumb/${KEY}` },
      error: null,
    };
    h.headObject.mockResolvedValue({ exists: true, sizeBytes: 10, etag: "e" });
    await thumbnailAttachment({ attachmentId: ID });
    expect(h.headObject).toHaveBeenCalledWith(`thumb/${KEY}`);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.updates).toHaveLength(0);
  });

  it("re-renders when the thumbnail is recorded but its object is gone", async () => {
    h.select = {
      data: { id: ID, r2_key: KEY, mime_type: "image/jpeg", thumb_r2_key: `thumb/${KEY}` },
      error: null,
    };
    h.headObject.mockResolvedValue({ exists: false });
    await thumbnailAttachment({ attachmentId: ID });
    expect(sentCommands().map((c) => c.name)).toEqual(["GetObjectCommand", "PutObjectCommand"]);
  });

  it("reads the original, resizes to 400px, writes under thumb/ and records the key", async () => {
    await thumbnailAttachment({ attachmentId: ID });

    const cmds = sentCommands();
    expect(cmds.map((c) => c.name)).toEqual(["GetObjectCommand", "PutObjectCommand"]);
    expect(cmds[0]?.input).toMatchObject({ Bucket: "app-bucket", Key: KEY });
    expect(cmds[1]?.input).toMatchObject({
      Bucket: "app-bucket",
      Key: `thumb/${KEY}`,
      ContentType: "image/jpeg",
    });
    expect(h.resize).toHaveBeenCalledWith(
      expect.objectContaining({ width: 400, height: 400, fit: "inside" })
    );
    expect(h.updates).toEqual([{ patch: { thumb_r2_key: `thumb/${KEY}` }, eq: [["id", ID]] }]);
  });

  it("throws when the object body cannot be read", async () => {
    h.send.mockImplementation(async () => ({ Body: undefined }));
    await expect(thumbnailAttachment({ attachmentId: ID })).rejects.toThrow(/could not read object body/);
    expect(h.updates).toHaveLength(0);
  });

  it("throws when recording the thumbnail key fails", async () => {
    h.update = { data: null, error: { message: "update refused" } };
    await expect(thumbnailAttachment({ attachmentId: ID })).rejects.toThrow("update refused");
  });
});
