import { describe, expect, it, vi } from "vitest";
import { cachedProbe } from "./cached-probe";

describe("cachedProbe (APX-57)", () => {
  it("runs once per window, however often it is asked", async () => {
    let clock = 0;
    const run = vi.fn(async () => ({ db: true }));
    const probe = cachedProbe(run, 10_000, () => clock);

    await probe();
    clock = 9_999;
    await probe();
    await probe();
    expect(run).toHaveBeenCalledTimes(1);

    clock = 10_000;
    await probe();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("concurrent callers share the one check in flight", async () => {
    let release: (v: string) => void = () => undefined;
    const run = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const probe = cachedProbe(run, 10_000, () => 0);

    const a = probe();
    const b = probe();
    release("ok");

    expect(await a).toBe("ok");
    expect(await b).toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("a failed check is not cached — the next caller tries again", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValueOnce("up");
    const probe = cachedProbe(run, 10_000, () => 0);

    await expect(probe()).rejects.toThrow("down");
    expect(await probe()).toBe("up");
  });
});
