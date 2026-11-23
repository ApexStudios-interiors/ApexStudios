import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import {
  billingTotals,
  isIssuedBill,
  lineBlock,
  lineKey,
  phaseBillingLabel,
  previewBill,
  selectAllLines,
  selectionIssue,
  sumAmounts,
  toggleLine,
  type BillForTotals,
  type ProjectBillingRates,
  type SelectableLine,
} from "./service";

/**
 * The Billable Now selection rules (APX-07, APX-17), the package Billing
 * tab's phase label (APX-49) and the billing totals (APX-32) — the billing
 * engine's pure half, under the 100% branch bar (vitest.config.mts). The
 * database half of the same rules is tests/integration/billing-mas.test.ts.
 */

const RATES: ProjectBillingRates = {
  gstRatePct: 18,
  retentionPct: 5,
  tdsPct: 0,
  mobilisationAdvance: 0,
  mobilisationRecovered: 0,
  mobilisationRecoveryPct: 0,
};

function phase(id: string, extra: Partial<SelectableLine> = {}): SelectableLine {
  return {
    sourceType: "phase",
    sourceId: id,
    phaseId: id,
    blockedByBillNo: null,
    amount: 100000,
    internalCost: 60000,
    masRecovery: 0,
    ...extra,
  };
}

function material(id: string, phaseId: string | null, extra: Partial<SelectableLine> = {}): SelectableLine {
  return {
    sourceType: "material",
    sourceId: id,
    phaseId,
    blockedByBillNo: null,
    amount: 3000,
    internalCost: 2000,
    ...extra,
  };
}

const P1 = phase("p1");
const P2 = phase("p2", { blockedByBillNo: "RA-APX-03" });
const M1 = material("m1", "p1");
const M2 = material("m2", "p3");
const LINES = [P1, P2, M1, M2];

describe("lineKey", () => {
  it("keys by type and id, so a phase and a stock request can never collide", () => {
    expect(lineKey(P1)).toBe("phase:p1");
    expect(lineKey({ sourceType: "material", sourceId: "p1" })).toBe("material:p1");
  });
});

describe("lineBlock", () => {
  it("a phase with material on a draft is blocked, naming the draft (R3)", () => {
    expect(lineBlock(P2, LINES, new Set())).toEqual({ kind: "draft_pending", billNo: "RA-APX-03" });
  });

  it("an unblocked phase is free", () => {
    expect(lineBlock(P1, LINES, new Set())).toBeNull();
  });

  it("a material is blocked while its own phase is ticked (R2), and free otherwise", () => {
    expect(lineBlock(M1, LINES, new Set([lineKey(P1)]))).toEqual({ kind: "phase_selected" });
    expect(lineBlock(M1, LINES, new Set())).toBeNull();
    expect(lineBlock(M2, LINES, new Set([lineKey(P1)]))).toBeNull();
  });

  it("a material with no phase is never blocked by a phase", () => {
    const orphan = material("m9", null);
    expect(lineBlock(orphan, [...LINES, orphan], new Set([lineKey(P1)]))).toBeNull();
  });
});

describe("toggleLine", () => {
  it("unticks a ticked line", () => {
    expect(toggleLine(LINES, new Set([lineKey(M2)]), lineKey(M2)).size).toBe(0);
  });

  it("ticking a phase unticks its own materials, and leaves other materials alone", () => {
    const next = toggleLine(LINES, new Set([lineKey(M1), lineKey(M2)]), lineKey(P1));
    expect([...next].sort()).toEqual([lineKey(M2), lineKey(P1)].sort());
  });

  it("a material cannot be ticked while its phase is", () => {
    const next = toggleLine(LINES, new Set([lineKey(P1)]), lineKey(M1));
    expect([...next]).toEqual([lineKey(P1)]);
  });

  it("a blocked phase cannot be ticked", () => {
    expect(toggleLine(LINES, new Set(), lineKey(P2)).size).toBe(0);
  });

  it("an unknown key changes nothing", () => {
    expect(toggleLine(LINES, new Set(), "phase:nope").size).toBe(0);
  });

  it("ticking a material adds just that material", () => {
    expect([...toggleLine(LINES, new Set(), lineKey(M2))]).toEqual([lineKey(M2)]);
  });
});

describe("selectAllLines", () => {
  it("every unblocked phase, then every material whose phase is not among them", () => {
    const orphan = material("m9", null);
    const all = selectAllLines([...LINES, orphan]);
    expect([...all].sort()).toEqual([lineKey(P1), lineKey(M2), lineKey(orphan)].sort());
  });

  it("a blocked phase's own materials are still selectable", () => {
    const m = material("m5", "p2");
    expect([...selectAllLines([P2, m])]).toEqual([lineKey(m)]);
  });

  it("nothing to select", () => {
    expect(selectAllLines([]).size).toBe(0);
  });
});

describe("selectionIssue — mirrors rpc_create_bill's refusals, in its order", () => {
  const issue = (lines: SelectableLine[]) => selectionIssue(lines, previewBill(lines, RATES));

  it("nothing selected", () => {
    expect(issue([])).toBe("NOTHING_SELECTED");
  });

  it("a material with its own phase: MAS_SAME_BILL (APX-07 ordering 1)", () => {
    expect(issue([P1, M1])).toBe("MAS_SAME_BILL");
  });

  it("a phase whose material is on a draft: MAS_DRAFT_PENDING (ordering 2)", () => {
    expect(issue([P2])).toBe("MAS_DRAFT_PENDING");
  });

  it("recovery above gross: MAS_EXCEEDS_GROSS (APX-31)", () => {
    expect(issue([phase("p7", { amount: 5000, masRecovery: 8000 })])).toBe("MAS_EXCEEDS_GROSS");
  });

  it("a material with no phase alongside phases is fine", () => {
    expect(issue([P1, material("m9", null), M2])).toBeNull();
  });

  it("APX-07 ordering 1, the audit's own figures: the material can only go on alone", () => {
    // Phase ₹10,00,000; its marble's advance ₹3,00,000. Ticked together, the
    // bill is refused; select-all leaves the marble out; the phase alone
    // taxes ₹10,00,000, not ₹13,00,000.
    const phaseLine = phase("pp", { amount: 1000000, internalCost: 600000 });
    const marble = material("mm", "pp", { amount: 300000, internalCost: 200000 });
    expect(issue([phaseLine, marble])).toBe("MAS_SAME_BILL");
    const all = selectAllLines([phaseLine, marble]);
    expect([...all]).toEqual([lineKey(phaseLine)]);
    expect(previewBill([phaseLine], RATES).taxableAmount.toNumber()).toBe(1000000);
  });
});

describe("phaseBillingLabel (APX-49)", () => {
  it.each([
    ["billed", false, "Billed"],
    ["billed", true, "Billed"],
    ["paid", true, "Paid"],
    ["billable", true, "Billable"],
    ["unresolved", true, "Billable"],
    ["billable", false, "Pending"],
    ["unresolved", false, "Pending"],
  ] as const)("%s, complete=%s -> %s", (billingStatus, isComplete, expected) => {
    expect(phaseBillingLabel({ billingStatus, isComplete })).toBe(expected);
  });
});

describe("isIssuedBill", () => {
  it.each([
    ["draft", false],
    ["cancelled", false],
    ["submitted", true],
    ["certified", true],
    ["paid", true],
  ] as const)("%s -> %s", (status, expected) => {
    expect(isIssuedBill(status)).toBe(expected);
  });
});

describe("billingTotals (APX-32)", () => {
  const bills: BillForTotals[] = [
    { id: "d", status: "draft", invoiceTotal: 1000, netPayable: 900 },
    { id: "x", status: "cancelled", invoiceTotal: 5000, netPayable: 4500 },
    { id: "s", status: "submitted", invoiceTotal: "1180.00", netPayable: "1130.00" },
    { id: "c", status: "certified", invoiceTotal: 2360, netPayable: 2260 },
    { id: "p", status: "paid", invoiceTotal: 118, netPayable: 113 },
  ];

  it("billed to date counts issued bills only — never a draft or a cancelled draft", () => {
    const t = billingTotals(bills, new Map());
    expect(t.billedToDate.toNumber()).toBe(1180 + 2360 + 118);
    expect(t.billedCount).toBe(3);
  });

  it("received is the sum of payments, part-payments included", () => {
    const t = billingTotals(
      bills,
      new Map<string, Decimal | number>([
        ["c", new Decimal("1000.10")],
        ["p", 113],
      ])
    );
    expect(t.received.toString()).toBe("1113.1");
    expect(t.paidCount).toBe(2);
    expect(t.outstanding.toString()).toBe("1259.9"); // (2260 + 113) - (1000.10 + 113)
  });

  it("outstanding never goes negative", () => {
    const t = billingTotals(
      [{ id: "p", status: "paid", invoiceTotal: 118, netPayable: 113 }],
      new Map([["p", 200]])
    );
    expect(t.outstanding.toNumber()).toBe(0);
  });

  it("a payment on a draft or cancelled bill is never counted", () => {
    const t = billingTotals(bills, new Map([["x", 50]]));
    expect(t.received.toNumber()).toBe(0);
  });
});

describe("sumAmounts", () => {
  it("adds in Decimal, not float", () => {
    expect(sumAmounts([{ amount: 0.1 }, { amount: 0.2 }]).toString()).toBe("0.3");
    expect(sumAmounts([]).toNumber()).toBe(0);
  });
});
