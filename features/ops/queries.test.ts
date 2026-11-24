import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const { latestBackupFailure } = await import("./queries");

const row = (name: string, status: string, last_error: string | null = null) => ({
  name,
  status,
  last_error,
  finished_at: "2026-11-24T21:00:05Z",
});

describe("latestBackupFailure (APX-19 banner)", () => {
  it("is null when every backup job's newest run succeeded", () => {
    expect(
      latestBackupFailure([row("backup.verify", "succeeded"), row("backup.nightly", "succeeded")])
    ).toBeNull();
  });

  it("reports a failed newest backup.verify", () => {
    expect(latestBackupFailure([row("backup.verify", "failed", "BACKUP_TOO_SMALL: …")])).toEqual({
      name: "backup.verify",
      lastError: "BACKUP_TOO_SMALL: …",
      finishedAt: "2026-11-24T21:00:05Z",
    });
  });

  it("reports a failed newest backup.nightly", () => {
    expect(latestBackupFailure([row("backup.nightly", "failed")])?.name).toBe("backup.nightly");
  });

  it("an older failure followed by a success clears the banner", () => {
    expect(
      latestBackupFailure([row("backup.verify", "succeeded"), row("backup.verify", "failed")])
    ).toBeNull();
  });

  it("a job still being retried (pending) is not yet a failure", () => {
    expect(latestBackupFailure([row("backup.verify", "pending", "NotFound")])).toBeNull();
  });

  it("ignores any other job name", () => {
    expect(latestBackupFailure([row("bill.pdf", "failed")])).toBeNull();
  });
});
