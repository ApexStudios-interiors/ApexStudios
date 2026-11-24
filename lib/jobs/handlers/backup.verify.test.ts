import { beforeEach, describe, expect, it, vi } from "vitest";

/** APX-19: exists, is not tiny, and has not halved since yesterday. The fake
 *  S3 client answers HeadObject only and throws on anything else, so these
 *  tests also pin that the check never reads or writes the backup bytes. */

const h = vi.hoisted(() => ({
  objects: new Map<string, number>(),
  headError: null as Error | null,
  clientConfig: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: {
    R2_ACCOUNT_ID: "acct",
    R2_ACCESS_KEY_ID: "app-key",
    R2_SECRET_ACCESS_KEY: "app-secret",
    R2_BACKUP_BUCKET: "apex-backups",
    R2_BACKUP_ACCESS_KEY_ID: "ro-key",
    R2_BACKUP_SECRET_ACCESS_KEY: "ro-secret",
  },
}));
vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>();
  class S3Client {
    constructor(config: unknown) {
      h.clientConfig = config;
    }
    async send(cmd: unknown) {
      if (!(cmd instanceof actual.HeadObjectCommand)) throw new Error("unexpected command");
      if (h.headError) throw h.headError;
      const size = h.objects.get(String(cmd.input.Key));
      if (size === undefined) {
        const e = new Error("NotFound");
        e.name = "NotFound";
        throw e;
      }
      return { ContentLength: size };
    }
  }
  return { ...actual, S3Client };
});

const { checkBackup, backupKey, MIN_BACKUP_BYTES } = await import("./backup.verify");

const NOW = new Date("2026-11-24T21:00:00Z");
const TODAY = "pg_dump/2026-11-24.sql.gz";
const YESTERDAY = "pg_dump/2026-11-23.sql.gz";

beforeEach(() => {
  h.objects.clear();
  h.headError = null;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("backup.verify", () => {
  it("keys by UTC date", () => {
    expect(backupKey(NOW)).toBe(TODAY);
  });

  it("uses the read-only backup credential, not the app's", async () => {
    h.objects.set(TODAY, 5_000_000);
    await checkBackup(NOW);
    expect(h.clientConfig).toMatchObject({
      credentials: { accessKeyId: "ro-key", secretAccessKey: "ro-secret" },
    });
  });

  it("passes for a normal-sized dump that has grown", async () => {
    h.objects.set(YESTERDAY, 4_000_000);
    h.objects.set(TODAY, 4_100_000);
    await expect(checkBackup(NOW)).resolves.toEqual({
      key: TODAY,
      bytes: 4_100_000,
      previousBytes: 4_000_000,
    });
  });

  it("fails when today's object is missing", async () => {
    await expect(checkBackup(NOW)).rejects.toThrow(/NotFound/);
  });

  it("fails when today's object is 10 KB or less", async () => {
    h.objects.set(TODAY, MIN_BACKUP_BYTES);
    await expect(checkBackup(NOW)).rejects.toThrow(/BACKUP_TOO_SMALL/);
  });

  it("fails when today's object is under half of yesterday's", async () => {
    h.objects.set(YESTERDAY, 4_000_000);
    h.objects.set(TODAY, 1_999_999);
    await expect(checkBackup(NOW)).rejects.toThrow(/BACKUP_SHRANK/);
  });

  it("passes at exactly half of yesterday's", async () => {
    h.objects.set(YESTERDAY, 4_000_000);
    h.objects.set(TODAY, 2_000_000);
    await expect(checkBackup(NOW)).resolves.toMatchObject({ bytes: 2_000_000 });
  });

  it("passes with no dump yesterday (first night, or yesterday already alerted)", async () => {
    h.objects.set(TODAY, 3_000_000);
    await expect(checkBackup(NOW)).resolves.toMatchObject({ previousBytes: null });
  });

  it("a non-404 error reading yesterday's object is not swallowed", async () => {
    h.objects.set(TODAY, 3_000_000);
    let calls = 0;
    const realGet = h.objects.get.bind(h.objects);
    vi.spyOn(h.objects, "get").mockImplementation((k: string) => {
      calls++;
      if (k === YESTERDAY) {
        const e = new Error("AccessDenied");
        e.name = "AccessDenied";
        throw e;
      }
      return realGet(k);
    });
    await expect(checkBackup(NOW)).rejects.toThrow(/AccessDenied/);
    expect(calls).toBe(2);
  });
});
