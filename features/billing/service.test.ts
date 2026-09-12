import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { previewBill, type BillableLine, type ProjectBillingRates } from "./service";

/**
 * build/09-billing.md §5, "the highest bar in the repository." 100% branch
 * coverage on this file — it computes tax.
 */

const NO_ADVANCE: ProjectBillingRates = {
  gstRatePct: 18,
  retentionPct: 5,
  tdsPct: 0,
  mobilisationAdvance: 0,
  mobilisationRecovered: 0,
  mobilisationRecoveryPct: 0,
};

describe("previewBill — T-01: taxable computed before retention, GST base = taxable", () => {
  it("asserts the exact figure, not just 'different from the buggy version'", () => {
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 100000, internalCost: 60000 }];
    const result = previewBill(lines, NO_ADVANCE);

    // The bug: gst on (taxable - retention) = 95000 * 18% = 17100.
    const buggyGst = new Decimal(100000).minus(5000).times(0.18);
    expect(result.taxableAmount.toNumber()).toBe(100000);
    expect(result.gstAmount.toNumber()).toBe(18000); // 100000 * 18%, on the FULL taxable value
    expect(result.gstAmount.toNumber()).not.toBe(buggyGst.toNumber());
    expect(result.retentionAmount.toNumber()).toBe(5000); // 100000 * 5%, computed independently of GST
    expect(result.invoiceTotal.toNumber()).toBe(118000); // taxable + gst
    expect(result.netPayable.toNumber()).toBe(113000); // invoiceTotal - retention - tds - advance
  });
});

describe("previewBill — GST rate variants", () => {
  it.each([
    [0, 0],
    [5, 5000],
    [12, 12000],
    [18, 18000],
  ])("gst_rate_pct=%s%% on 100000 taxable -> gst=%s", (rate, expectedGst) => {
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 100000, internalCost: 0 }];
    const result = previewBill(lines, { ...NO_ADVANCE, retentionPct: 0, gstRatePct: rate });
    expect(result.gstAmount.toNumber()).toBe(expectedGst);
  });
});

describe("previewBill — line composition", () => {
  it("material only", () => {
    const lines: BillableLine[] = [{ sourceType: "material", amount: 5000, internalCost: 4000 }];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.workValue.toNumber()).toBe(0);
    expect(result.materialValue.toNumber()).toBe(5000);
    expect(result.grossAmount.toNumber()).toBe(5000);
  });

  it("phases only", () => {
    const lines: BillableLine[] = [
      { sourceType: "phase", amount: 30000, internalCost: 20000 },
      { sourceType: "phase", amount: 20000, internalCost: 15000 },
    ];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.workValue.toNumber()).toBe(50000);
    expect(result.materialValue.toNumber()).toBe(0);
  });

  it("both phases and material", () => {
    const lines: BillableLine[] = [
      { sourceType: "phase", amount: 30000, internalCost: 20000 },
      { sourceType: "material", amount: 7500, internalCost: 5000 },
    ];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.workValue.toNumber()).toBe(30000);
    expect(result.materialValue.toNumber()).toBe(7500);
    expect(result.grossAmount.toNumber()).toBe(37500);
  });

  it("no lines at all — every total is zero, not an error", () => {
    const result = previewBill([], NO_ADVANCE);
    expect(result.grossAmount.toNumber()).toBe(0);
    expect(result.netPayable.toNumber()).toBe(0);
  });

  it("accepts a Decimal instance directly, not just number/string", () => {
    const lines: BillableLine[] = [{ sourceType: "phase", amount: new Decimal(1000), internalCost: new Decimal(600) }];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.workValue.toNumber()).toBe(1000);
  });
});

describe("previewBill — MAS recovery", () => {
  it("recovers a phase's prior material advance from gross before computing taxable", () => {
    const lines: BillableLine[] = [
      { sourceType: "phase", amount: 50000, internalCost: 30000, priorMaterialAdvanceOnThisPhase: 5000 },
    ];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.masRecoveryAmount.toNumber()).toBe(5000);
    expect(result.taxableAmount.toNumber()).toBe(45000); // 50000 - 5000
  });

  it("MAS recovery exceeding gross floors taxable at zero, not negative", () => {
    const lines: BillableLine[] = [
      { sourceType: "phase", amount: 5000, internalCost: 3000, priorMaterialAdvanceOnThisPhase: 8000 },
    ];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.taxableAmount.toNumber()).toBe(0);
    expect(result.gstAmount.toNumber()).toBe(0);
    expect(result.netPayable.toNumber()).toBe(0);
  });

  it("a material line's own priorMaterialAdvanceOnThisPhase is never read", () => {
    // The field is meaningless on a 'material' line — this asserts it has no
    // effect even if a caller mistakenly sets it there.
    const lines: BillableLine[] = [
      { sourceType: "material", amount: 5000, internalCost: 4000, priorMaterialAdvanceOnThisPhase: 9999 },
    ];
    const result = previewBill(lines, NO_ADVANCE);
    expect(result.masRecoveryAmount.toNumber()).toBe(0);
  });
});

describe("previewBill — rounding", () => {
  it("a value chosen so naive float arithmetic produces a paisa error", () => {
    // 33333.33 * 18% = 5999.9994, which float multiplication mangles past
    // the second decimal; decimal.js rounds it correctly half-up to 6000.00.
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 33333.33, internalCost: 0 }];
    const result = previewBill(lines, { ...NO_ADVANCE, retentionPct: 0 });
    expect(result.gstAmount.toNumber()).toBe(6000);
    // The float version of this exact multiplication is provably NOT exact.
    expect(0.18 * 33333.33).not.toBe(6000);
  });

  it("half-up rounding at the .005 boundary", () => {
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 100.05, internalCost: 0 }];
    // retention_pct chosen so taxable * pct lands exactly on a half-paisa.
    const result = previewBill(lines, { ...NO_ADVANCE, gstRatePct: 0, retentionPct: 50 });
    expect(result.retentionAmount.toNumber()).toBe(50.03); // 50.025 rounds up
  });
});

describe("previewBill — mobilisation advance recovery", () => {
  it("recovers the lesser of the remaining balance and the per-bill rate", () => {
    const rates: ProjectBillingRates = {
      ...NO_ADVANCE,
      mobilisationAdvance: 100000,
      mobilisationRecovered: 90000,
      mobilisationRecoveryPct: 20, // 20% of a 100000 taxable = 20000, but only 10000 remains
    };
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 100000, internalCost: 0 }];
    const result = previewBill(lines, { ...rates, retentionPct: 0, gstRatePct: 0 });
    expect(result.advanceRecovery.toNumber()).toBe(10000); // capped by remaining balance, not the rate
  });

  it("recovers the rate-based amount when it is less than the remaining balance", () => {
    const rates: ProjectBillingRates = {
      ...NO_ADVANCE,
      mobilisationAdvance: 100000,
      mobilisationRecovered: 0,
      mobilisationRecoveryPct: 10,
    };
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 50000, internalCost: 0 }];
    const result = previewBill(lines, { ...rates, retentionPct: 0, gstRatePct: 0 });
    expect(result.advanceRecovery.toNumber()).toBe(5000); // 10% of 50000, well under the 100000 balance
  });

  it("a fully-recovered advance (remaining balance zero) recovers nothing further", () => {
    const rates: ProjectBillingRates = {
      ...NO_ADVANCE,
      mobilisationAdvance: 50000,
      mobilisationRecovered: 50000,
      mobilisationRecoveryPct: 50,
    };
    const lines: BillableLine[] = [{ sourceType: "phase", amount: 100000, internalCost: 0 }];
    const result = previewBill(lines, { ...rates, retentionPct: 0, gstRatePct: 0 });
    expect(result.advanceRecovery.toNumber()).toBe(0);
  });
});

describe("previewBill — net_payable reconciles across generated cases (T- list)", () => {
  function seedRandom(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1103515245 + 12345) % 2147483648;
      return s / 2147483648;
    };
  }

  const rand = seedRandom(42);
  const cases = Array.from({ length: 50 }, (_, i) => {
    const workValue = Math.round(rand() * 500000 * 100) / 100;
    const materialValue = Math.round(rand() * 200000 * 100) / 100;
    const internalCost = Math.round(rand() * 300000 * 100) / 100;
    const priorAdvance = Math.round(rand() * 50000 * 100) / 100;
    const GST_RATES = [0, 5, 12, 18] as const;
    const gstRatePct = GST_RATES[i % GST_RATES.length] ?? 18;
    const retentionPct = rand() * 10;
    const tdsPct = rand() * 2;
    const mobilisationAdvance = Math.round(rand() * 100000 * 100) / 100;
    const mobilisationRecovered = Math.round(rand() * mobilisationAdvance * 100) / 100;
    const mobilisationRecoveryPct = rand() * 20;
    return {
      workValue,
      materialValue,
      internalCost,
      priorAdvance,
      gstRatePct,
      retentionPct,
      tdsPct,
      mobilisationAdvance,
      mobilisationRecovered,
      mobilisationRecoveryPct,
    };
  });

  it.each(cases.map((c, i) => [i, c] as const))("case %i reconciles G - H - I - J to the paisa", (_, c) => {
    const lines: BillableLine[] = [
      { sourceType: "phase", amount: c.workValue, internalCost: c.internalCost, priorMaterialAdvanceOnThisPhase: c.priorAdvance },
      { sourceType: "material", amount: c.materialValue, internalCost: 0 },
    ];
    const result = previewBill(lines, {
      gstRatePct: c.gstRatePct,
      retentionPct: c.retentionPct,
      tdsPct: c.tdsPct,
      mobilisationAdvance: c.mobilisationAdvance,
      mobilisationRecovered: c.mobilisationRecovered,
      mobilisationRecoveryPct: c.mobilisationRecoveryPct,
    });

    const expectedNet = result.invoiceTotal
      .minus(result.retentionAmount)
      .minus(result.tdsAmount)
      .minus(result.advanceRecovery);
    expect(result.netPayable.toNumber()).toBe(expectedNet.toNumber());

    // Every stored figure is rounded to at most 2 decimal places.
    for (const field of [
      result.gstAmount,
      result.retentionAmount,
      result.tdsAmount,
      result.advanceRecovery,
      result.netPayable,
    ]) {
      expect(field.decimalPlaces()).toBeLessThanOrEqual(2);
    }
  });

  it("covers all 50 generated scenarios", () => {
    expect(cases.length).toBe(50);
  });
});
