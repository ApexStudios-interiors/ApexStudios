"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { recordPayment, getBillPaymentsSummaryForDialog } from "@/features/billing/actions";
import { formatINR } from "@/lib/money";
import { dmy } from "@/lib/logic";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";

/** UTC-anchored, like every other date-only field in this app. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * build/09-billing.md §4.5's own "Record Payment dialog." Part-payment is
 * normal (payments is a table, never a `paid_amount` column) — this shows
 * what has already been paid and lets the admin record another instalment.
 * `rpc_record_payment` itself refuses an amount that would exceed
 * net_payable (build's own "decide, document, test" — recorded in
 * docs/decisions.md); this is the field-level message ahead of that.
 */
export function RecordPaymentDialog({
  billId,
  refNo,
  netPayable,
}: {
  billId: string;
  refNo: string;
  netPayable: number;
}) {
  const { closeDialog, toast } = useApp();
  const router = useRouter();
  const [paidSoFar, setPaidSoFar] = useState<number | null>(null);
  const [payments, setPayments] = useState<{ id: string; amount: number; paidOn: string }[]>([]);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [mode, setMode] = useState<"neft" | "cheque" | "upi" | "rtgs">("neft");
  const [referenceNo, setReferenceNo] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBillPaymentsSummaryForDialog(billId)
      .then((summary) => {
        setPaidSoFar(summary.paidSoFar);
        setPayments(summary.payments);
      })
      .catch(() => toast("Could not load this bill's payment history."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  const remaining = paidSoFar === null ? null : Math.max(netPayable - paidSoFar, 0);

  async function onSubmit() {
    const parsed = Number(amount);
    if (!amount || !(parsed > 0)) {
      setError("Enter a positive amount");
      return;
    }
    setPending(true);
    setError(null);
    const result = await recordPayment({
      billId,
      amount: parsed,
      paidOn,
      mode,
      referenceNo: referenceNo || undefined,
      idempotencyKey,
    });
    setPending(false);
    if (!result?.data) {
      setError(result?.serverError ?? "Could not record this payment");
      return;
    }
    closeDialog();
    router.refresh();
    toast(result.data.status === "paid" ? "Payment recorded — bill fully paid" : "Payment recorded");
  }

  return (
    <DialogShell
      title="Record Payment"
      description={`${refNo} · ${remaining !== null ? formatINR(remaining) : "…"} outstanding`}
      okLabel={pending ? "Recording…" : "Record Payment"}
      okDisabled={pending}
      onClose={closeDialog}
      onOk={onSubmit}
    >
      {payments.length > 0 && (
        <div className="mb-3.5 text-[12.5px] text-muted-foreground">
          Already paid: {formatINR(paidSoFar ?? 0)} across {payments.length} payment
          {payments.length > 1 ? "s" : ""}
          {payments.map((p) => (
            <div key={p.id}>
              {dmy(p.paidOn)} · {formatINR(p.amount)}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3.5">
        <div className="col-span-2">
          <Field label="Amount" htmlFor="rp-amount">
            <input
              id="rp-amount"
              type="number"
              step="0.01"
              className={inputClass}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
        <Field label="Paid On" htmlFor="rp-date">
          <input
            id="rp-date"
            type="date"
            className={inputClass}
            value={paidOn}
            onChange={(e) => setPaidOn(e.target.value)}
          />
        </Field>
        <Field label="Mode" htmlFor="rp-mode">
          <select
            id="rp-mode"
            className={inputClass}
            value={mode}
            onChange={(e) => setMode(e.target.value as typeof mode)}
          >
            <option value="neft">NEFT</option>
            <option value="rtgs">RTGS</option>
            <option value="upi">UPI</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
        <div className="col-span-2">
          <Field label="Reference No." htmlFor="rp-ref">
            <input
              id="rp-ref"
              className={inputClass}
              placeholder="Optional"
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
