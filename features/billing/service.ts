import { Decimal } from "decimal.js";

/**
 * build/09-billing.md §3. The `decimal.js` preview engine — pure, no
 * `next/*` (code-standards §1). This is the file the 100% branch coverage
 * requirement lands on: it computes tax, and `rpc_create_bill` is its own
 * independent, authoritative implementation in `numeric` SQL. This file
 * exists ONLY to preview totals in the Billable Now selector as a user
 * ticks boxes — Postgres is authoritative (`02-lld.md` §3.8); nothing here
 * is ever stored.
 *
 * The order is fixed and is this build's entire reason to exist (AGENTS.md
 * billing rules, `01-hld.md` §8.4):
 *
 *   A work_value      Σ completed phase milestones × client value
 *   B material_value  Σ delivered material × client value × mas_billable_pct
 *   C gross           A + B
 *   D mas_recovery    material previously advanced under B whose phase is
 *                     now billed in full under A
 *   E taxable         C − D                                ← THE GST BASE
 *   F gst             E × gst_rate_pct                       ← on E, NEVER E − retention
 *   G invoice_total   E + F
 *   H retention       E × retention_pct                      ← on basic value, after GST
 *   I tds             E × tds_pct                             (informational, D5)
 *   J advance_recovery  least(remaining mobilisation advance, E × mobilisation_recovery_pct)
 *   K net_payable     G − H − I − J
 *
 * Deducting retention before computing GST is the prototype's own bug
 * (`lib/logic.ts`'s `billTotals`) — T-01 exists specifically to catch a
 * reintroduction of it. Rounding: half-up to two decimals at F, H, I — the
 * same points `rpc_create_bill`'s own `round(x, 2)` calls round at, so a CA
 * hand-checking a bill reconciles to the paisa against this preview too.
 */

export type MoneyLike = Decimal | string | number;

export type BillableLine = {
  sourceType: "phase" | "material";
  /** Client value already at pct_billed (100% for a phase, mas_billable_pct
   *  for material) — the same `amount` column `v_billable_now` computes. */
  amount: MoneyLike;
  internalCost: MoneyLike;
  /** Only meaningful on a 'phase' line: `v_billable_now.mas_recovery`, the
   *  material advance on COMMITTED bills tied to this phase — the very column
   *  `rpc_create_bill` sums at step D (APX-30: one definition, so the preview
   *  is the bill). Never read on a 'material' line. */
  masRecovery?: MoneyLike;
};

export type ProjectBillingRates = {
  gstRatePct: MoneyLike;
  retentionPct: MoneyLike;
  tdsPct: MoneyLike;
  mobilisationAdvance: MoneyLike;
  mobilisationRecovered: MoneyLike;
  mobilisationRecoveryPct: MoneyLike;
};

export type BillPreview = {
  workValue: Decimal;
  materialValue: Decimal;
  grossAmount: Decimal;
  masRecoveryAmount: Decimal;
  taxableAmount: Decimal;
  gstAmount: Decimal;
  invoiceTotal: Decimal;
  retentionAmount: Decimal;
  tdsAmount: Decimal;
  advanceRecovery: Decimal;
  netPayable: Decimal;
  internalCostAmount: Decimal;
  marginAmount: Decimal;
  /** Step D larger than step C. `rpc_create_bill` refuses such a bill
   *  (MAS_EXCEEDS_GROSS, APX-31) rather than flooring taxable at zero and
   *  silently losing the remainder; the preview flags it so Create Bill can
   *  say why before the round trip. Taxable shows as 0 meanwhile. */
  masRecoveryExceedsGross: boolean;
};

const ZERO = new Decimal(0);

function d(v: MoneyLike): Decimal {
  return v instanceof Decimal ? v : new Decimal(v);
}

/** Half-up to two decimals — the one rounding mode this build ever uses
 *  (`02-lld.md` §1.4), applied at the same three points `rpc_create_bill`
 *  rounds at: gst, retention, tds. */
function round2(v: Decimal): Decimal {
  return v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function previewBill(lines: readonly BillableLine[], rates: ProjectBillingRates): BillPreview {
  let workValue = ZERO;
  let materialValue = ZERO;
  let internalCostAmount = ZERO;
  let masRecoveryAmount = ZERO;

  // One line per phase/stock request by construction (the caller builds
  // these from v_billable_now's own one-row-per-source shape, and the
  // selection is a set), so summing each phase line's own recovery figure
  // directly is correct — the same sum rpc_create_bill takes over its
  // de-duplicated selection.
  for (const line of lines) {
    const amount = d(line.amount);
    internalCostAmount = internalCostAmount.plus(d(line.internalCost));
    if (line.sourceType === "phase") {
      workValue = workValue.plus(amount);
      masRecoveryAmount = masRecoveryAmount.plus(d(line.masRecovery ?? 0));
    } else {
      materialValue = materialValue.plus(amount);
    }
  }

  const grossAmount = workValue.plus(materialValue);
  // MAS recovery exceeding gross: rpc_create_bill refuses the bill
  // (MAS_EXCEEDS_GROSS). The preview still renders, with taxable at zero
  // rather than negative, and says so through masRecoveryExceedsGross.
  const masRecoveryExceedsGross = masRecoveryAmount.greaterThan(grossAmount);
  const taxableAmount = Decimal.max(grossAmount.minus(masRecoveryAmount), ZERO);

  const gstAmount = round2(taxableAmount.times(d(rates.gstRatePct)).dividedBy(100));
  const invoiceTotal = taxableAmount.plus(gstAmount);
  const retentionAmount = round2(taxableAmount.times(d(rates.retentionPct)).dividedBy(100));
  const tdsAmount = round2(taxableAmount.times(d(rates.tdsPct)).dividedBy(100));

  const remainingAdvance = Decimal.max(
    d(rates.mobilisationAdvance).minus(d(rates.mobilisationRecovered)),
    ZERO
  );
  const advanceRecovery = Decimal.min(
    remainingAdvance,
    round2(taxableAmount.times(d(rates.mobilisationRecoveryPct)).dividedBy(100))
  );

  const netPayable = invoiceTotal.minus(retentionAmount).minus(tdsAmount).minus(advanceRecovery);
  const marginAmount = taxableAmount.minus(internalCostAmount);

  return {
    workValue,
    materialValue,
    grossAmount,
    masRecoveryAmount,
    taxableAmount,
    gstAmount,
    invoiceTotal,
    retentionAmount,
    tdsAmount,
    advanceRecovery,
    netPayable,
    internalCostAmount,
    marginAmount,
    masRecoveryExceedsGross,
  };
}

// ── Billable Now selection (APX-07, APX-17) ─────────────────────────────────
//
// The same rules rpc_create_bill enforces (migration 20261124200001, D68),
// applied while the admin ticks boxes so the database refusal is never the
// first the admin hears of them. The database remains the enforcement.

/** One Billable Now row as the selector needs it. `phaseId` is the phase a
 *  material belongs to (always set for a material, by R4) and the phase's own
 *  id on a phase row; `blockedByBillNo` is the draft bill holding one of a
 *  phase's materials (R3), null otherwise. */
export type SelectableLine = BillableLine & {
  sourceId: string;
  phaseId: string | null;
  blockedByBillNo: string | null;
};

/** Selection key. Phase and stock request ids come from different tables, so
 *  the type is part of the key. */
export function lineKey(line: { sourceType: BillableLine["sourceType"]; sourceId: string }): string {
  return `${line.sourceType}:${line.sourceId}`;
}

export type LineBlock =
  /** R3: a phase whose material sits on a draft bill. */
  | { kind: "draft_pending"; billNo: string }
  /** R2: a material whose own phase is ticked on this bill. */
  | { kind: "phase_selected" };

function selectedPhaseIds(lines: readonly SelectableLine[], selected: ReadonlySet<string>): Set<string> {
  return new Set(
    lines.filter((l) => l.sourceType === "phase" && selected.has(lineKey(l))).map((l) => l.sourceId)
  );
}

/** Why this line cannot be ticked right now, or null when it can. */
export function lineBlock(
  line: SelectableLine,
  lines: readonly SelectableLine[],
  selected: ReadonlySet<string>
): LineBlock | null {
  if (line.sourceType === "phase") {
    return line.blockedByBillNo ? { kind: "draft_pending", billNo: line.blockedByBillNo } : null;
  }
  return line.phaseId && selectedPhaseIds(lines, selected).has(line.phaseId)
    ? { kind: "phase_selected" }
    : null;
}

/** Ticks or unticks one line. Ticking a phase unticks its own materials (R2):
 *  the phase's value already includes them. A blocked line stays unticked. */
export function toggleLine(
  lines: readonly SelectableLine[],
  selected: ReadonlySet<string>,
  key: string
): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  const line = lines.find((l) => lineKey(l) === key);
  if (!line || lineBlock(line, lines, selected)) return next;
  next.add(key);
  if (line.sourceType === "phase") {
    for (const m of lines) {
      if (m.sourceType === "material" && m.phaseId === line.sourceId) next.delete(lineKey(m));
    }
  }
  return next;
}

/** The header "select all": every phase that is not blocked, then every
 *  material whose phase is not among them. */
export function selectAllLines(lines: readonly SelectableLine[]): Set<string> {
  const phases = lines.filter((l) => l.sourceType === "phase" && !l.blockedByBillNo);
  const phaseIds = new Set(phases.map((p) => p.sourceId));
  const materials = lines.filter(
    (l) => l.sourceType === "material" && !(l.phaseId && phaseIds.has(l.phaseId))
  );
  return new Set([...phases, ...materials].map(lineKey));
}

export type SelectionIssue = "NOTHING_SELECTED" | "MAS_SAME_BILL" | "MAS_DRAFT_PENDING" | "MAS_EXCEEDS_GROSS";

/** The first reason rpc_create_bill would refuse this selection, checked in
 *  the RPC's own order, or null when it would create the bill. */
export function selectionIssue(
  selectedLines: readonly SelectableLine[],
  preview: BillPreview
): SelectionIssue | null {
  if (selectedLines.length === 0) return "NOTHING_SELECTED";
  const phaseIds = new Set(selectedLines.filter((l) => l.sourceType === "phase").map((l) => l.sourceId));
  if (selectedLines.some((l) => l.sourceType === "material" && l.phaseId && phaseIds.has(l.phaseId))) {
    return "MAS_SAME_BILL";
  }
  if (selectedLines.some((l) => l.sourceType === "phase" && l.blockedByBillNo)) return "MAS_DRAFT_PENDING";
  if (preview.masRecoveryExceedsGross) return "MAS_EXCEEDS_GROSS";
  return null;
}

// ── Phase billing label (APX-49) ─────────────────────────────────────────────

/** The package Billing tab's badge for a phase. "Billable" means exactly what
 *  v_billable_now means by it: complete, and still open for billing. A phase
 *  whose status column still reads 'unresolved' but whose tasks are all done
 *  IS billable — the column alone is not what decides it. */
export function phaseBillingLabel(row: {
  billingStatus: "unresolved" | "billable" | "billed" | "paid";
  isComplete: boolean;
}): "Pending" | "Billable" | "Billed" | "Paid" {
  if (row.billingStatus === "billed") return "Billed";
  if (row.billingStatus === "paid") return "Paid";
  return row.isComplete ? "Billable" : "Pending";
}

// ── Billing totals (APX-32) ──────────────────────────────────────────────────

export type BillStatus = "draft" | "submitted" | "certified" | "paid" | "cancelled";

/** A bill that has been sent to the client and stands: submitted, certified
 *  or paid. Never a draft (not yet an invoice) and never a cancelled draft
 *  (never sent at all). */
export function isIssuedBill(status: BillStatus): boolean {
  return status === "submitted" || status === "certified" || status === "paid";
}

export type BillForTotals = {
  id: string;
  status: BillStatus;
  invoiceTotal: MoneyLike;
  netPayable: MoneyLike;
};

export type BillingTotals = {
  /** Σ invoice_total over issued bills. */
  billedToDate: Decimal;
  billedCount: number;
  /** Σ every payment recorded against an issued bill — part-payments
   *  included, not only bills that are fully paid. */
  received: Decimal;
  /** Issued bills with at least one payment recorded. */
  paidCount: number;
  /** Σ net_payable (certified, paid) − Σ payments on them; never negative
   *  (02-lld.md §3.8). */
  outstanding: Decimal;
};

export function billingTotals(
  bills: readonly BillForTotals[],
  paidByBill: ReadonlyMap<string, MoneyLike>
): BillingTotals {
  let billedToDate = ZERO;
  let received = ZERO;
  let owed = ZERO;
  let paidOnOwed = ZERO;
  let billedCount = 0;
  let paidCount = 0;
  for (const b of bills) {
    if (!isIssuedBill(b.status)) continue;
    billedCount++;
    billedToDate = billedToDate.plus(d(b.invoiceTotal));
    const paid = d(paidByBill.get(b.id) ?? 0);
    received = received.plus(paid);
    if (paid.greaterThan(0)) paidCount++;
    if (b.status !== "submitted") {
      owed = owed.plus(d(b.netPayable));
      paidOnOwed = paidOnOwed.plus(paid);
    }
  }
  return {
    billedToDate,
    billedCount,
    received,
    paidCount,
    outstanding: Decimal.max(owed.minus(paidOnOwed), ZERO),
  };
}

/** Σ amount over lines, in Decimal — Billable Now's own stat tile and the
 *  client's stat row, never a float reduce. */
export function sumAmounts(lines: readonly { amount: MoneyLike }[]): Decimal {
  return lines.reduce((acc, l) => acc.plus(d(l.amount)), ZERO);
}
