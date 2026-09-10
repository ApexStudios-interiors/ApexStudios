import { describe, expect, it } from "vitest";
import {
  computeCommitted,
  costToClientFactor,
  durationWeightedProgress,
  packageStatusLabel,
  phaseVariance,
  weightedProgress,
} from "./service";

describe("weightedProgress", () => {
  it("T-16: weights by allocated amount, not a plain average", () => {
    // ₹40L at 100% + ₹2L at 0% -> 95%, not 50% — the whole point of the
    // weighting (build/04-projects-packages-phases.md's test matrix).
    const pct = weightedProgress([
      { allocated: 40_00_000, progressPct: 100 },
      { allocated: 2_00_000, progressPct: 0 },
    ]);
    expect(pct).toBe(95);
  });

  it("returns 0 for an empty project rather than dividing by zero", () => {
    expect(weightedProgress([])).toBe(0);
  });

  it("returns 0 when every package has zero allocation", () => {
    expect(weightedProgress([{ allocated: 0, progressPct: 100 }])).toBe(0);
  });

  it("matches a plain average when every package is equally allocated", () => {
    const pct = weightedProgress([
      { allocated: 100, progressPct: 40 },
      { allocated: 100, progressPct: 60 },
    ]);
    expect(pct).toBe(50);
  });
});

describe("durationWeightedProgress", () => {
  it("T-16: a 3-week task at 100% and a 1-week task at 0% is 75%, not 50%", () => {
    const pct = durationWeightedProgress([
      { durationWeeks: 3, progressPct: 100 },
      { durationWeeks: 1, progressPct: 0 },
    ]);
    expect(pct).toBe(75);
  });

  it("returns 0 for a phase with no tasks", () => {
    expect(durationWeightedProgress([])).toBe(0);
  });
});

describe("computeCommitted", () => {
  it("counts approved, ordered and delivered requests", () => {
    const total = computeCommitted([
      { status: "approved", qty: 10, rate: 100 },
      { status: "ordered", qty: 5, rate: 200 },
      { status: "delivered", qty: 2, rate: 50 },
    ]);
    expect(total).toBe(10 * 100 + 5 * 200 + 2 * 50);
  });

  it("excludes pending and rejected requests", () => {
    const total = computeCommitted([
      { status: "pending", qty: 100, rate: 1000 },
      { status: "rejected", qty: 100, rate: 1000 },
    ]);
    expect(total).toBe(0);
  });

  it("treats a null rate as zero rather than throwing or producing NaN", () => {
    expect(computeCommitted([{ status: "approved", qty: 10, rate: null }])).toBe(0);
  });
});

describe("costToClientFactor", () => {
  it("uses the phase's own factor when the phase has an internal amount", () => {
    const factor = costToClientFactor(
      { allocatedAmount: 150, internalAmount: 100 },
      { allocatedAmount: 999, internalAmount: 999 }
    );
    expect(factor).toBe(1.5);
  });

  it("falls back to the package's factor when the phase has no internal amount", () => {
    const factor = costToClientFactor(
      { allocatedAmount: 0, internalAmount: 0 },
      { allocatedAmount: 120, internalAmount: 100 }
    );
    expect(factor).toBe(1.2);
  });

  it("falls back to the package's factor when no phase is given at all", () => {
    const factor = costToClientFactor(null, { allocatedAmount: 120, internalAmount: 100 });
    expect(factor).toBe(1.2);
  });

  it("falls all the way back to 1.0 when neither has margin data — bill at cost, visibly", () => {
    expect(costToClientFactor(null, null)).toBe(1.0);
    expect(costToClientFactor({ allocatedAmount: 0, internalAmount: 0 }, { allocatedAmount: 0, internalAmount: 0 })).toBe(
      1.0
    );
  });
});

describe("phaseVariance", () => {
  it("surfaces the gap without judging it (HLD §5.2: surface, don't block)", () => {
    expect(phaseVariance(10_00_000, 8_00_000)).toBe(2_00_000);
  });

  it("is negative when phases sum to more than the package — still not an error", () => {
    expect(phaseVariance(10_00_000, 12_00_000)).toBe(-2_00_000);
  });

  it("is zero when phases exactly account for the package", () => {
    expect(phaseVariance(5_00_000, 5_00_000)).toBe(0);
  });
});

describe("packageStatusLabel", () => {
  it("maps every package_status enum value to its display string", () => {
    expect(packageStatusLabel("not_started")).toBe("Not started");
    expect(packageStatusLabel("design")).toBe("Design");
    expect(packageStatusLabel("in_progress")).toBe("In progress");
    expect(packageStatusLabel("completed")).toBe("Completed");
  });

  it("falls back to the raw value for anything unrecognised, rather than throwing", () => {
    expect(packageStatusLabel("unknown_status")).toBe("unknown_status");
  });
});
