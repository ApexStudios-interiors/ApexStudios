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
  /** Only meaningful on a 'phase' line: the total of prior material
   *  bill_lines advanced against stock requests tied to THIS phase
   *  (mirrors `rpc_create_bill`'s own step-5 query). 0 for a phase with no
   *  prior material advance, and always 0 on a 'material' line itself. */
  priorMaterialAdvanceOnThisPhase?: MoneyLike;
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
  // these from v_billable_now's own one-row-per-source shape), so summing
  // each phase line's own prior-advance figure directly is correct — no
  // dedup needed.
  for (const line of lines) {
    const amount = d(line.amount);
    internalCostAmount = internalCostAmount.plus(d(line.internalCost));
    if (line.sourceType === "phase") {
      workValue = workValue.plus(amount);
      masRecoveryAmount = masRecoveryAmount.plus(d(line.priorMaterialAdvanceOnThisPhase ?? 0));
    } else {
      materialValue = materialValue.plus(amount);
    }
  }

  const grossAmount = workValue.plus(materialValue);
  // MAS recovery exceeding gross: taxable floors at zero rather than going
  // negative (build §5's own "decide and assert the behaviour" case) — the
  // same floor `rpc_create_bill`'s `greatest(..., 0)` applies.
  const taxableAmount = Decimal.max(grossAmount.minus(masRecoveryAmount), ZERO);

  const gstAmount = round2(taxableAmount.times(d(rates.gstRatePct)).dividedBy(100));
  const invoiceTotal = taxableAmount.plus(gstAmount);
  const retentionAmount = round2(taxableAmount.times(d(rates.retentionPct)).dividedBy(100));
  const tdsAmount = round2(taxableAmount.times(d(rates.tdsPct)).dividedBy(100));

  const remainingAdvance = Decimal.max(d(rates.mobilisationAdvance).minus(d(rates.mobilisationRecovered)), ZERO);
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
  };
}
