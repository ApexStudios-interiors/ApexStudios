"use client";

import { useEffect, useState } from "react";
import { Decimal } from "decimal.js";
import { useRouter } from "next/navigation";
import { useApp } from "@/context/AppContext";
import { recordPayment, getBillPaymentsSummaryForDialog } from "@/features/billing/actions";
import { formatINR } from "@/lib/money";
import { parseMoneyInput } from "@/lib/money/input";
import { MoneyEcho } from "@/components/shared/MoneyEcho";
import { dmy } from "@/lib/logic";
import { DialogShell, Field, inputClass } from "@/components/ui/DialogShell";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/shared/DatePicker";
import { todayIst } from "@/lib/dates";

/** Base UI's `Select.Value` renders the raw value ("neft") unless the root is
 *  given `items` to resolve its label from. Order matches the old `<option>`s. */
const PAYMENT_MODES = [
  { value: "neft", label: "NEFT" },
  { value: "rtgs", label: "RTGS" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

/** Kept in step with the list above rather than spelled out a second time —
 *  `recordPaymentSchema.mode` is the matching server-side enum. */
type PaymentMode = (typeof PAYMENT_MODES)[number]["value"];

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
  // Today in Asia/Kolkata. The UTC default this replaces dated a payment
  // recorded between 00:00 and 05:30 IST to the previous day — on a financial
  // record that feeds the GST return.
  const [paidOn, setPaidOn] = useState(todayIst());
  const [mode, setMode] = useState<PaymentMode>("neft");
  const [referenceNo, setReferenceNo] = useState("");
  // APX-33: one key per distinct payment the admin means to record. It is
  // KEPT when an attempt's answer was lost (the connection dropped after the
  // payment may already have committed): the retry then finds that payment
  // through rpc_record_payment's idempotency check instead of recording it a
  // second time. It is REPLACED after any definite answer from the server
  // (a refusal such as OVERPAYMENT), and whenever a field changes — a
  // corrected amount is a different payment and must never be swallowed by
  // the key of an earlier attempt.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const renewKey = () => setIdempotencyKey(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getBillPaymentsSummaryForDialog(billId)
      .then((summary) => {
        setPaidSoFar(summary.paidSoFar);
        setPayments(summary.payments);
      })
      .catch(() => toast("Could not load this bill's payment history.", "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [billId]);

  const remaining = paidSoFar === null ? null : Math.max(netPayable - paidSoFar, 0);

  async function onSubmit() {
    // APX-40: "1,25,000" is how the amount is written on the cheque — strip
    // the grouping before validating, through the shared money parser.
    const normalised = parseMoneyInput(amount);
    const parsed = normalised === null ? NaN : Number(normalised);
    if (!(parsed > 0)) {
      setError("Enter a positive amount, like 1,25,000 or 125000.50");
      return;
    }
    if (new Decimal(amount).decimalPlaces() > 2) {
      setError("Use at most two decimals (paise)");
      return;
    }
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof recordPayment>>;
    try {
      result = await recordPayment({
        billId,
        amount: parsed,
        paidOn,
        mode,
        referenceNo: referenceNo || undefined,
        idempotencyKey,
      });
    } catch {
      // No answer: the payment may or may not have been recorded. Keep the
      // key, so pressing Record Payment again cannot record it twice.
      setPending(false);
      setError(
        "The connection dropped before an answer came back. Press Record Payment again — it will not be recorded twice."
      );
      return;
    }
    setPending(false);
    if (!result?.data) {
      renewKey();
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
      okPending={pending}
      dirty={amount.trim() !== "" || referenceNo.trim() !== ""}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <div className="sm:col-span-2">
          <Field label="Amount" htmlFor="rp-amount">
            <input
              id="rp-amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="₹ e.g. 1,25,000"
              className={inputClass}
              value={amount}
              aria-invalid={!!error}
              aria-describedby="rp-amount-echo"
              onChange={(e) => {
                setAmount(e.target.value);
                renewKey();
              }}
            />
          </Field>
          <MoneyEcho id="rp-amount-echo" value={amount} />
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
        <Field label="Paid On" htmlFor="rp-date">
          <DatePicker
            id="rp-date"
            value={paidOn}
            onChange={(v) => {
              setPaidOn(v);
              renewKey();
            }}
            required
          />
        </Field>
        <Field label="Mode" htmlFor="rp-mode">
          <Select
            items={PAYMENT_MODES}
            value={mode}
            onValueChange={(v) => {
              if (v) {
                setMode(v);
                renewKey();
              }
            }}
          >
            <SelectTrigger id="rp-mode" className="w-full text-[13.5px] data-[size=default]:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PAYMENT_MODES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Reference No." htmlFor="rp-ref">
            <input
              id="rp-ref"
              className={inputClass}
              placeholder="Optional"
              value={referenceNo}
              onChange={(e) => {
                setReferenceNo(e.target.value);
                renewKey();
              }}
            />
          </Field>
        </div>
      </div>
    </DialogShell>
  );
}
