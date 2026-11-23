import { describe, expect, it, vi } from "vitest";

/**
 * The registry is "the single place a job name exists". Every registered job
 * is drained (APX-23: a failed scheduled job retries on the drain's backoff,
 * not 24 hours later), and nothing is drained that has no handler — a drained
 * name without one would be claimed and failed on every tick.
 */

vi.mock("server-only", () => ({}));
vi.mock("./handlers/attachment.thumbnail", () => ({ thumbnailAttachment: vi.fn() }));
vi.mock("./handlers/attachment.orphan-sweep", () => ({ sweepOrphanAttachments: vi.fn() }));
vi.mock("./handlers/inventory.reconcile", () => ({ reconcileInventory: vi.fn() }));
vi.mock("./handlers/project.archive", () => ({ archiveCompletedProjects: vi.fn() }));
vi.mock("./handlers/backup.verify", () => ({ verifyBackup: vi.fn() }));
vi.mock("./handlers/bill.pdf", () => ({ generateBillPdf: vi.fn() }));

const { DRAIN_JOB_NAMES, JOB_REGISTRY } = await import("./registry");

describe("job registry", () => {
  it("every drained name has a handler", () => {
    for (const name of DRAIN_JOB_NAMES) {
      expect(typeof JOB_REGISTRY[name], `no handler for drained job "${name}"`).toBe("function");
    }
  });

  it("every registered job is drained", () => {
    const drained = new Set<string>(DRAIN_JOB_NAMES);
    for (const name of Object.keys(JOB_REGISTRY)) {
      expect(drained.has(name), `"${name}" is registered but never drained`).toBe(true);
    }
  });

  it("lists each drained name once", () => {
    expect(new Set(DRAIN_JOB_NAMES).size).toBe(DRAIN_JOB_NAMES.length);
  });
});
