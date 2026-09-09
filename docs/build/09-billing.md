# Build 09 — The Billing Engine

> **This file is a prompt.** It is the hard one. The code written here computes tax on documents
> that go to a client and to an assessing officer. Treat every shortcut as a liability.
>
> **Depends on:** Builds 04, 05, 07 — bills draw from completed phases and delivered material.
> **Blocks:** go-live.
> **Branch:** `build/09-billing`

---

## 0. Prerequisites — what a human must do outside the codebase

### 0.1 CA sign-off — genuinely blocking

`01-hld.md` §8.4 lists five tax questions that are **flagged for CA review, not decided in code
review** (`AGENTS.md` billing rules). Every one needs a written answer before this build ships,
and the fifth needs one before the first bill is issued.

- [ ] **1. The correct GST rate for Apex's contracts.** 18% for a pure works contract, but a
      composite supply for under-construction residential can attract 5% or 12%, and it varies by
      contract type. The platform stores it per project; the CA decides what goes in the field.
- [ ] **2. TDS under 194C** — does the platform compute it as a deduction, or is it left entirely
      to the client's accounts team? Recommendation (D5) is an informational line only.
- [ ] **3. Material-at-site at 75%** — is it structured in Apex's contracts as a **secured
      advance** (recoverable, arguably not a supply at that moment) or as a **sale of goods**
      (immediately taxable)? **The GST treatment differs and this changes the schema.** D4
      recommends secured advance. If the CA says otherwise, stop and re-scope — do not implement
      around it.
- [ ] **4. Delivery challans** for warehouse→site transfers (carried unresolved as C2).
- [ ] **5. E-invoicing (IRN) applicability** based on Apex's aggregate turnover. If Apex is above
      the threshold, every B2B invoice must be registered on the IRP and carry an IRN and a signed
      QR code. **That is a separate integration and it is not in this build.** Find out now: it
      changes whether these bills are legally valid invoices.
- [ ] **A CA has reviewed a generated RA bill** against a real one and signed off on the layout,
      the arithmetic and the wording. This is `01-hld.md` §17's exit criterion for Phase 4 and it
      is the exit criterion for this build.

### 0.2 Commercial and document data

- [ ] **Apex's invoice header**: legal name, GSTIN, PAN, registered address, state code, contact,
      bank details for payment, and a logo file at print resolution.
- [ ] **The client's invoice details**: legal name, GSTIN, billing address, state code.
      Place of supply determines CGST+SGST versus IGST — an inter-state contract billed as
      intra-state is a filing correction, and the schema currently stores a single `gst_amount`.
      **Confirm with the CA whether the split is needed.** If it is, it is a schema change and it
      belongs in this build, not a later one. Record as **D20.**
- [ ] **A real past RA bill from Apex**, ideally three, to reconcile the engine against. This is
      the highest-value artefact in the whole build: a golden-file test against a document a human
      has already checked is worth more than any amount of unit testing against your own
      assumptions.
- [ ] **Bill numbering confirmed**: `RA-{project_code}-{nn}` (D6). Gapless, per project, and
      permanent.
- [ ] **Retention release terms**: when is retained money released, and does the platform track
      it? It is currently deducted and never seen again. If Apex needs a retention release
      schedule, that is new scope — decide, don't discover. Record as **D21.**
- [ ] **Mobilisation advance (D7)**: does any live contract have one, and what is the recovery
      schedule? `projects.mobilisation_advance` and `mobilisation_recovered` exist; the recovery
      rate does not. If D7 is yes, add the column here.

### 0.3 Operational

- [ ] **A feature flag decision.** `architecture.md` §10.2 suggests shipping Billing dark behind
      an environment-variable boolean during Phase 4, enabled per project. Confirm.
- [ ] **Who is allowed to issue the first real bill**, and who checks it before it is sent.

---

## 1. Objective

Billable Now, bill creation with correct arithmetic, the full bill lifecycle including client
certification, payments, PDF and Excel output, and an admin-only margin block — with 100% branch
coverage on everything that touches money.

---

## 2. The arithmetic, and the bug being fixed

The prototype computes, in `lib/logic.ts:billTotals`:

```ts
const taxable = gross - recovery;
const ret = (taxable * RET) / 100;
const gst = (taxable * GST) / 100;
return { net: taxable - ret + gst, … };
```

Read the `net` line carefully. Retention is deducted and GST is added to the same base, which is
arithmetically fine — **but the prototype's UI summary presents it as "Taxable → less 5%
retention → +18% GST"**, and any implementation that follows that presentation charges GST on
95% of the value.

Under Indian GST, retention money is part of the value of the supply. Tax is payable on the full
RA bill value including the retained amount, whether or not the money has been received.
Deducting retention from the tax base understates output GST, which becomes a liability at
assessment.

**The correct order (`01-hld.md` §8.4), and the only order this build implements:**

```
A  work_value      Σ completed phase milestones × client value
B  material_value  Σ delivered material × client value × mas_billable_pct   (default 75%)
C  gross           A + B
D  mas_recovery    material previously advanced under B that is now inside a phase billed under A
E  taxable         C − D                                    ← THE GST BASE
F  gst             E × gst_rate_pct                          ← on E, NOT on E − retention
G  invoice_total   E + F
H  retention       E × retention_pct                         ← on basic value, after GST is computed
I  tds             E × tds_pct
J  advance_recovery per the recovery schedule, if any
K  net_payable     G − H − I − J
```

`AGENTS.md` says it plainly: *"If you find code deducting retention before computing GST, that is
a bug — the earlier prototype had it that way. Fix it and add a test."* T-01 is that test.

**Rounding** (`02-lld.md` §1.4): half-up to two decimal places at the point of storage, never at
display. Percentages apply to already-rounded bases so a CA hand-checking the bill reconciles to
the paisa.

---

## 3. Where the arithmetic lives

**Postgres is authoritative.** `rpc_create_bill` computes every figure in `numeric` and stores
all of them (`02-lld.md` §3.8 — `work_value` through `net_payable` are columns, never recomputed
on read). This is what makes an issued bill immutable and reproducible.

The TypeScript service exists **only** to preview totals in the Billable Now selector as the user
ticks boxes. It must:
- use `decimal.js`, never JavaScript numbers — `0.1 + 0.2` in a tax computation is not acceptable;
- implement the identical order of operations;
- be covered by a test that runs a table of ~50 generated scenarios through **both** the TS
  service and the SQL RPC and asserts they agree to the paisa.

That equivalence test is the guard against the preview and the invoice disagreeing, which is the
failure mode that erodes trust in the whole system.

---

## 4. Steps

### 4.1 `rpc_create_bill`

Implement `02-lld.md` §5.5 in full. Its ten steps, with the reasoning for the ones that are easy
to get wrong:

1. `is_admin()` and `is_member_of(project_id)`.
2. **`select * from projects where id = ? for update`** — this row lock is what serialises
   `next_bill_seq` and produces gapless, non-duplicated RA bill numbers. A `count(*) + 1` races
   and produces two `RA-BHEL-NCH-03`s (T-03).
3. Materialise the selected rows from `v_billable_now`, filtered to `p_lines`. Raise
   `NOTHING_SELECTED` if empty; raise `ALREADY_BILLED` if any `source_id` already has a bill line.
4. `work_value` = Σ phase lines; `material_value` = Σ material lines; `gross` = the sum.
5. **MAS recovery.** Σ of prior *material* bill lines whose `stock_request.phase_id` is in the set
   of phases now being billed as complete. This is the anti-double-billing mechanism: 75% was
   advanced against the material, and the phase containing that material is now being billed in
   full, so the advance is recovered. Get this wrong and the client is billed twice for the same
   marble (T-02).
6. `taxable`, `gst`, `invoice_total`, `retention`, `tds`, `advance_recovery`, `net_payable` — in
   the §2 order, with `fn_money()` rounding at each store.
7. `internal_cost` = Σ line internal cost; `margin` = `taxable − internal_cost`.
   **Admin-only columns**, selected only by an admin session.
8. `bill_no = 'RA-' || projects.code || '-' || lpad(seq, 2, '0')`;
   `update projects set next_bill_seq = next_bill_seq + 1`.
9. Insert `bills` — **snapshotting `gst_rate_pct`, `retention_pct`, `tds_pct` from the project**
   (ADR-006). A later change to the project's GST rate must never restate an issued invoice.
   Insert `bill_lines`. Set the billed phases to `billing_status = 'billed'` and the billed
   requests' `billed_on_bill_id`.
10. `bill_events` (null → draft) and `fn_audit`.

**Idempotency**: accept a client-generated `idempotency_key` and return the existing bill if it
has already been used (`architecture.md` §8.3). A double-clicked Create Bill button must not
produce two RA bills.

The unique index `idx_bill_lines_source` is the database-level backstop for step 3: a phase or a
delivered material can appear on exactly one bill line across the entire system (T-04).

### 4.2 `rpc_transition_bill`

`02-lld.md` §5.6, and the table is the specification:

| From | To | Who | Side effects |
|---|---|---|---|
| draft | submitted | admin/owner | Lines freeze; enqueue `bill.pdf`; `submitted_at`, `submitted_by` |
| draft | cancelled | admin/owner | **Delete** `bill_lines`, reset phases to `billable`, clear `billed_on_bill_id` |
| submitted | certified | **client only** | `certified_by`, `certified_at`, `certification_note` |
| submitted | draft | **client only** | Rejection; reason mandatory; `revision += 1` |
| certified | paid | admin/owner | Requires `Σ payments >= net_payable` |

Anything else raises `ILLEGAL_TRANSITION`.

Two rules with no exceptions:
- **An admin attempting `submitted → certified` raises `FORBIDDEN`** (T-05). This single
  constraint is what gives client certification its commercial meaning.
- **A bill is immutable from `submitted` onward** (`01-hld.md` §8.3). Corrections are a credit
  note or an adjustment on the next RA bill, never an edit. This is a GST requirement, not a
  preference.

`cancelled` is the one place the system hard-deletes rows — the `bill_lines` deletion is
deliberate, so the unique index frees up and those items return to Billable Now
(`02-lld.md` §3.8). Everything else is soft-deleted. Comment it as an exception so nobody
"fixes" it into a soft delete later.

### 4.3 `rpc_record_payment`

`(bill_id, amount, paid_on, mode, reference_no)`, admin, with an idempotency key.
Inserts a `payments` row and auto-transitions the bill to `paid` when
`Σ payments >= net_payable`. Part-payment is normal in Indian construction, which is why
payments are a table and **not** a `paid_amount` column on `bills` (`02-lld.md` §3.8).

Outstanding = `Σ bills.net_payable (certified, paid) − Σ payments.amount`.

Reject a payment that would exceed `net_payable`, or allow it with a warning — decide, document,
and test whichever. Overpayment happens in the real world; silently accepting it and then showing
a negative outstanding is the worst option.

### 4.4 `features/billing/`

- **`service.ts`** — the `decimal.js` preview engine (§3), pure, no `next/*`. This is the file
  that carries the 100% branch coverage requirement.
- **`queries.ts`** —
  `getBillableNow(session, projectId)` over `v_billable_now`, admin only;
  `getBillsForAdmin(session, projectId)` — full table including margin;
  `getBillsForClient(session, projectId)` over `v_bill_client` — **no `internal_cost_amount`, no
  `margin_amount`, no line-level `internal_cost`, not present in the select list at all**;
  `getBillDetail(...)` in both shapes.
- **`actions.ts`** — `createBill`, `transitionBill`, `recordPayment`, `uploadBillCopy`,
  `exportBill` (`02-lld.md` §7).

### 4.5 The Billing surfaces

**Admin (`docs/ui-guide.md` §6.11):**
- Stat row: Billed to Date, Received, Outstanding, Billable Now.
- **Billable Now** card — a checkbox-selectable table of completed phases and delivered
  materials, with a running total of selected value **and selected margin**, and **+ Create Bill**.
  The running totals come from the `decimal.js` preview service.
- **Bills** card — Date, Packages, Taxable, Net Payable, Margin, Status, and per-row actions:
  View, Upload, and the next transition button (Submit → Mark Paid; **never** Mark Certified).
- Record Payment dialog.

**Client ("Bills"):**
- Stat row: Bills Raised, Awaiting Approval, Approved Unpaid, Paid.
- Table: Date, Packages, Taxable, GST, Net Payable, Status, View, and **Approve** when a bill is
  Submitted — this is the certification.
- Reject with a mandatory reason, returning the bill to Draft with `revision += 1`.

**Bill detail dialog (both roles):** line items, and the summary rendered in the **corrected**
order:
```
Gross  →  less MAS recovery  →  Taxable  →  + GST  =  Invoice total
                                         →  less Retention, TDS, Advance  =  Net Payable
```
Note this is a **visible change from the prototype's summary**, which showed retention before
GST. It is the intended output of this build; put a before/after screenshot in the PR.
The Admin-only "Internal" box shows cost and margin. The client's dialog does not fetch them.

**Package Billing tab** (`docs/ui-guide.md` §6.5, admin only) — phase billing status with the
**Mark Complete** button (Build 05's `rpc_mark_phase_complete`), and the Material at Site table
showing Cost, Client Value, Billable at `mas_billable_pct`, and Status.

**Cumulative columns.** Indian RA bills are conventionally cumulative — each bill restates work
to date so earlier errors self-correct. Store discrete lines; render `billed to date`,
`this bill`, `cumulative` as a presentation over Σ prior bills (`01-hld.md` §8.4).

### 4.6 Bill PDF

`bill.pdf` job handler (stubbed in Build 06), rendering with `@react-pdf/renderer`, enqueued on
`draft → submitted`, stored in R2 and linked as an `attachment`.

- The layout comes from the real Apex bill collected in §0.2, not from imagination.
- It must carry: Apex's legal name, GSTIN, PAN and address; the client's name, GSTIN and billing
  address; bill number, bill date, period; line items; the full A–K breakdown with the snapshotted
  rates shown as percentages; amount in words; and the bank details.
- **Never** the internal cost or margin. Assert that in a test that renders a PDF and greps its
  text for the seeded internal figures.
- SLO: available within 60 seconds of submission (`architecture.md` §8.1). If the job fails, the
  bill is still Submitted and certifiable — the PDF appears on retry (`architecture.md` §8.4).

### 4.7 Excel export

`exceljs`, streamed directly from a route handler on request — **not a job**
(`01-hld.md` §10.2). Admin gets the full workbook including cost and margin; the guard is
`admin` only, per `02-lld.md` §7 (`pdf: any member · xlsx: admin`).

This is the accounting hand-off: Tally and Zoho stay external and a human moves the file
(`system-overview.md` §2). Shape the workbook for that purpose — ask whoever does Apex's data
entry what columns they need.

### 4.8 Feature flag

`BILLING_ENABLED` in the environment, checked in the route layout and in every billing action.
Off by default in production until the CA has signed off on a generated bill. Removing the flag
is a Build 10 task with its own line in the cutover checklist.

---

## 5. Tests — the highest bar in the repository

**Coverage gate: 100% branch on `features/billing/service.ts` and every billing RPC path.** It
computes tax. CI fails below it, and the threshold is not negotiable downward.

**Unit (`decimal.js` service)**
| ID | Assertion |
|---|---|
| T-01 | **Taxable is computed before retention; GST base = taxable.** Assert the exact figure, not just that it is different from the buggy version |
| — | Zero-rate GST, 5%, 12%, 18% all correct |
| — | A bill with only material; a bill with only phases; a bill with both |
| — | MAS recovery exceeding gross → taxable is not negative (decide and assert the behaviour) |
| — | Rounding: values chosen so naive float arithmetic produces a paisa error, asserting exact `numeric` behaviour |
| — | `net_payable` reconciles: `G − H − I − J`, to the paisa, across 50 generated cases |
| — | **TS preview ≡ SQL RPC** across the same 50 cases (§3) |

**Integration**
| ID | Assertion |
|---|---|
| T-02 | MAS recovery prevents a material billed at 75% being billed again inside its phase |
| T-03 | Two concurrent `createBill` calls on one project produce sequential, non-duplicate `bill_no` — run 50 times |
| T-04 | The `bill_lines` unique index rejects billing the same phase twice |
| T-05 | **An admin cannot transition `submitted → certified`** |
| — | A client cannot create a bill |
| — | Cancelling a draft returns its phases to `billable` and clears `billed_on_bill_id` |
| — | A submitted bill's lines cannot be updated or deleted by any role |
| — | Changing `projects.gst_rate_pct` after a bill is issued does not change that bill's figures |
| — | `recordPayment` transitions to `paid` only when the full `net_payable` is covered |
| — | Part payments accumulate correctly and Outstanding is right |
| — | A double-submitted `createBill` with the same idempotency key produces one bill |
| — | Client rejection returns the bill to draft with `revision = 2` and the reason recorded |

**pgTAP**
- A client session selecting `bills.internal_cost_amount` or `margin_amount` returns nothing.
- A client reading `v_bill_client` gets the taxable, GST and net figures and **no** cost column.
- A site session selecting anything from `bills` or `bill_lines` returns nothing (T-12).
- No role can update `bill_events`.

**Golden file**
Reproduce a **real past Apex RA bill** from seeded equivalents and assert every figure matches
the document a human already checked. If the engine and a real bill disagree, one of them is
wrong and finding out which is the entire point of this test.

**Playwright**
- *Admin:* select two phases and one delivered material in Billable Now → the running total and
  margin update → Create Bill → verify the stored figures → Submit → the PDF appears within 60s.
- *Client:* open the submitted bill → the summary shows GST on the taxable value → Approve →
  status is Certified.
- *Admin:* record a part payment, then the balance → status becomes Paid.
- *Client:* reject a bill with a reason → it returns to Draft at revision 2.
- *Client:* the bill dialog's DOM contains **no** internal cost or margin value.

---

## 6. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test --coverage && pnpm test:rls && pnpm test:e2e && pnpm build
```

- [ ] Coverage report shows **100% branch** on the billing service and RPC paths.
- [ ] **A CA has reviewed a generated RA bill PDF and signed off in writing.** This is the exit
      criterion from `01-hld.md` §17 Phase 4 and nothing ships without it.
- [ ] The golden-file test reproduces a real Apex bill exactly.
- [ ] T-03 run 50 times: no duplicate or gapped bill numbers.
- [ ] Grep a client session's RSC payload and rendered PDF for the seeded `internal_cost` and
      `margin` values. Zero hits in both.
- [ ] All five CA questions answered and recorded in `docs/decisions.md`; D20 and D21 recorded.
- [ ] `01-hld.md` §8.4's "requires CA confirmation" block updated with the answers.
- [ ] `docs/progress-tracker.md` updated.

---

## 7. Guardrails — do not

- **Do not compute GST on `taxable − retention`.** Ever. T-01 exists to catch it.
- **Do not use JavaScript numbers for money.** `decimal.js` in TS, `numeric` in SQL.
- **Do not hard-code 18%, 5% or 75%.** They are per-project columns with snapshots on each bill.
- **Do not recompute a stored bill figure on read.** The stored values are the invoice.
- **Do not allow an edit to a bill at `submitted` or beyond.** Credit note or next-bill adjustment.
- **Do not add an admin certification path**, including behind a flag or "for testing".
- **Do not add a `paid_amount` column to `bills`.** Part-payment goes in `payments`.
- **Do not let the margin block reach a client query**, a client PDF, a client Excel export, a log
  line or a Sentry breadcrumb.
- **Do not implement e-invoicing (IRN)** in this build. If §0.1 item 5 says it is required, stop
  and re-scope — it is a separate integration with its own compliance surface.
- **Do not ship with the feature flag on** before the CA sign-off exists.

---

## 8. Deliverables

- [ ] `rpc_create_bill` with the project row lock, gapless numbering, `ALREADY_BILLED`,
      MAS recovery, rate snapshotting and idempotency
- [ ] `rpc_transition_bill` implementing the five legal transitions and refusing everything else
- [ ] `rpc_record_payment` with part-payment support and auto-transition
- [ ] `features/billing/service.ts` — the `decimal.js` preview engine at 100% branch coverage
- [ ] Admin and client billing surfaces, bill detail dialog with the corrected summary,
      package Billing tab
- [ ] `bill.pdf` job with a CA-reviewed layout, and the no-margin assertion test
- [ ] Excel export streamed from a route handler, admin only
- [ ] `BILLING_ENABLED` flag, off in production until sign-off
- [ ] Tests: T-01 through T-05, the TS≡SQL equivalence suite, the golden-file test, the pgTAP
      column-absence set, five Playwright journeys
- [ ] CA sign-off recorded; `01-hld.md` §8.4 and `docs/decisions.md` updated
