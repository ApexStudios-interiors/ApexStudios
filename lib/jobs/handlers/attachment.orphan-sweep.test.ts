import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

/**
 * APX-06. The sweep's keep-decision now comes from `rpc_r2_keys_referenced`,
 * asked per page of R2 keys. These tests stand in a 1,500-row attachments
 * table behind that RPC — past PostgREST's silent 1,000-row cap, which is
 * exactly where the old one-unpaged-select version started deleting real
 * files — and an R2 bucket listed 1,000 keys a page.
 */

const DAY = 24 * 60 * 60 * 1000;
const OLD = new Date(Date.now() - 10 * DAY);
const YOUNG = new Date(Date.now() - 60 * 1000);

type Obj = { Key: string; LastModified: Date };

const h = vi.hoisted(() => ({
  env: { R2_BUCKET: "apex-studios", ORPHAN_SWEEP_DELETE: false },
  /** The fake attachments table: every key some row references. */
  referenced: new Set<string>(),
  bucket: [] as Obj[],
  rpcCalls: [] as string[][],
  rpcError: null as { message: string } | null,
  deleted: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: h.env }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: { p_keys: string[] }) => {
      if (name !== "rpc_r2_keys_referenced") throw new Error(`unexpected rpc ${name}`);
      h.rpcCalls.push(args.p_keys);
      if (h.rpcError) return { data: null, error: h.rpcError };
      return { data: args.p_keys.filter((k) => h.referenced.has(k)), error: null };
    },
  }),
}));
vi.mock("@/lib/r2/client", () => ({
  r2Client: () => ({
    send: async (cmd: unknown) => {
      if (cmd instanceof ListObjectsV2Command) {
        const start = Number(cmd.input.ContinuationToken ?? 0);
        const size = cmd.input.MaxKeys ?? 1000;
        const page = h.bucket.slice(start, start + size);
        const next = start + size;
        return {
          Contents: page,
          IsTruncated: next < h.bucket.length,
          NextContinuationToken: next < h.bucket.length ? String(next) : undefined,
        };
      }
      if (cmd instanceof DeleteObjectCommand) {
        h.deleted.push(String(cmd.input.Key));
        return {};
      }
      throw new Error("unexpected R2 command");
    },
  }),
}));

const { runOrphanSweep, sweepOrphanAttachments, KEY_CHECK_BATCH } = await import("./attachment.orphan-sweep");

/** 1,500 attachment rows, each with an original and (every other one) a thumbnail. */
function seedReferenced(rows = 1500) {
  for (let i = 0; i < rows; i++) {
    const key = `org/o/project/p/daily_update/e/${i}-photo.jpg`;
    h.referenced.add(key);
    h.bucket.push({ Key: key, LastModified: OLD });
    if (i % 2 === 0) {
      h.referenced.add(`thumb/${key}`);
      h.bucket.push({ Key: `thumb/${key}`, LastModified: OLD });
    }
  }
}

beforeEach(() => {
  h.env.ORPHAN_SWEEP_DELETE = false;
  h.referenced.clear();
  h.bucket.length = 0;
  h.rpcCalls.length = 0;
  h.rpcError = null;
  h.deleted.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("attachment.orphan_sweep (APX-06)", () => {
  it("with a 1,500-row attachments table and deletion ON, deletes nothing that is referenced", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(1500);

    const summary = await runOrphanSweep({});

    expect(summary.scanned).toBe(2250);
    expect(summary.referenced).toBe(2250);
    expect(summary.orphaned).toBe(0);
    expect(h.deleted).toEqual([]);
  });

  it("asks about each listed page in batches no larger than the response cap allows", async () => {
    seedReferenced(1500);
    await runOrphanSweep({});
    expect(h.rpcCalls.length).toBeGreaterThan(1);
    for (const batch of h.rpcCalls) expect(batch.length).toBeLessThanOrEqual(KEY_CHECK_BATCH);
    // Every key was asked about exactly once in pass 1 (no candidates, so no pass 2).
    expect(h.rpcCalls.flat().length).toBe(2250);
  });

  it("is a dry run by default: reports genuine orphans and deletes nothing", async () => {
    seedReferenced(1500);
    h.bucket.push({ Key: "org/o/project/p/x/orphan.jpg", LastModified: OLD });

    const summary = await runOrphanSweep({});

    expect(summary.mode).toBe("dry-run");
    expect(summary.orphaned).toBe(1);
    expect(h.deleted).toEqual([]);
  });

  it("deletes a genuine orphan when ORPHAN_SWEEP_DELETE is on", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(1500);
    h.bucket.push({ Key: "org/o/project/p/x/orphan.jpg", LastModified: OLD });

    const summary = await runOrphanSweep({});

    expect(summary.mode).toBe("delete");
    expect(summary.deleted).toBe(1);
    expect(h.deleted).toEqual(["org/o/project/p/x/orphan.jpg"]);
  });

  it("a payload asking for a dry run wins over the env flag", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(100);
    h.bucket.push({ Key: "orphan.jpg", LastModified: OLD });
    const summary = await runOrphanSweep({ dryRun: true });
    expect(summary.mode).toBe("dry-run");
    expect(h.deleted).toEqual([]);
  });

  it("never touches an object younger than 24 hours, referenced or not", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(200);
    h.bucket.push({ Key: "mid-upload.jpg", LastModified: YOUNG });

    const summary = await runOrphanSweep({});

    expect(summary.tooYoung).toBe(1);
    expect(h.deleted).toEqual([]);
    expect(h.rpcCalls.flat()).not.toContain("mid-upload.jpg");
  });

  it("circuit breaker: over 1% orphaned deletes NOTHING and fails the job in delete mode", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(1000); // 1,500 objects
    for (let i = 0; i < 20; i++) h.bucket.push({ Key: `orphan-${i}.jpg`, LastModified: OLD }); // 1.3%

    const summary = await runOrphanSweep({});
    expect(summary.tripped).toBe(true);
    expect(h.deleted).toEqual([]);

    await expect(sweepOrphanAttachments({})).rejects.toThrow(/ORPHAN_SWEEP_ABORTED/);
    expect(h.deleted).toEqual([]);
  });

  it("circuit breaker in a dry run is reported, not thrown", async () => {
    seedReferenced(100);
    for (let i = 0; i < 10; i++) h.bucket.push({ Key: `orphan-${i}.jpg`, LastModified: OLD });
    await expect(sweepOrphanAttachments({})).resolves.toBeUndefined();
    expect(h.deleted).toEqual([]);
  });

  it("the breaker would have caught the original bug: a keep-list cut at 1,000 rows", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(1500);
    // Simulate the old failure mode: the database only "knows" the first 1,000 originals.
    const firstThousand = [...h.referenced].filter((k) => !k.startsWith("thumb/")).slice(0, 1000);
    h.referenced.clear();
    for (const k of firstThousand) h.referenced.add(k);

    const summary = await runOrphanSweep({});
    expect(summary.tripped).toBe(true);
    expect(h.deleted).toEqual([]);
  });

  it("a database error stops the sweep before any delete — never read as 'not referenced'", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(10);
    h.rpcError = { message: "connection reset" };
    await expect(runOrphanSweep({})).rejects.toThrow(/key check failed: connection reset/);
    expect(h.deleted).toEqual([]);
  });

  it("re-checks candidates just before deleting, so a row recorded mid-sweep keeps its object", async () => {
    h.env.ORPHAN_SWEEP_DELETE = true;
    seedReferenced(200);
    h.bucket.push({ Key: "late.jpg", LastModified: OLD });

    // The first time "late.jpg" is asked about it is unreferenced; by the
    // re-check a row has been recorded for it.
    let seen = 0;
    const realHas = h.referenced.has.bind(h.referenced);
    vi.spyOn(h.referenced, "has").mockImplementation((k: string) => {
      if (k === "late.jpg") return seen++ > 0;
      return realHas(k);
    });

    const summary = await runOrphanSweep({});
    expect(summary.orphaned).toBe(0);
    expect(h.deleted).toEqual([]);
  });

  it("logs its counts", async () => {
    seedReferenced(10);
    await runOrphanSweep({});
    const logged = vi.mocked(console.log).mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.includes('"scanned":15'))).toBe(true);
  });
});
