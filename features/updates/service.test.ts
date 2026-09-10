import { describe, expect, it } from "vitest";
import { canEditUpdate } from "./service";

const AUTHOR = "author-1";
const OTHER = "author-2";

describe("canEditUpdate", () => {
  it("is true for the author, just under 24 hours old", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const createdAt = new Date(now.getTime() - (24 * 60 * 60 * 1000 - 1000)).toISOString();
    expect(canEditUpdate({ authorId: AUTHOR, createdAt }, AUTHOR, now)).toBe(true);
  });

  it("is false at exactly 24 hours", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const createdAt = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    expect(canEditUpdate({ authorId: AUTHOR, createdAt }, AUTHOR, now)).toBe(false);
  });

  it("is false at 25 hours — the build file's own boundary case", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const createdAt = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(canEditUpdate({ authorId: AUTHOR, createdAt }, AUTHOR, now)).toBe(false);
  });

  it("is false for anyone but the author, regardless of age", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const createdAt = now.toISOString();
    expect(canEditUpdate({ authorId: AUTHOR, createdAt }, OTHER, now)).toBe(false);
  });
});
