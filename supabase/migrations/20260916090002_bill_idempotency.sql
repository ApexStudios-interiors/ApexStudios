-- 0041 — idempotency columns for bills and payments
--
-- build/09-billing.md §4.1/§4.3: "A double-clicked Create Bill button must
-- not produce two RA bills" and recordPayment takes "an idempotency key."
-- A nullable column plus a PARTIAL unique index, `where idempotency_key is
-- not null` — the same shape idx_bill_lines_source (0010) already uses for
-- exactly this reason: both tables are seeded/created with many existing
-- rows that legitimately carry no key at all, so a plain `unique nulls not
-- distinct` (jobs' own shape, migration 0012 — safe there only because that
-- table started empty) would collapse every pre-existing NULL together and
-- refuse to even create the constraint. The partial index excludes NULL rows
-- entirely: two bills with no key never collide with each other, only two
-- carrying the SAME real key do.
alter table public.bills add column idempotency_key text;
create unique index bills_idem_uq
  on public.bills (project_id, idempotency_key)
  where idempotency_key is not null;

alter table public.payments add column idempotency_key text;
create unique index payments_idem_uq
  on public.payments (bill_id, idempotency_key)
  where idempotency_key is not null;

-- D11: "Money and stock mutations go through the RPCs... never through
-- application-level read-modify-write." `payments_insert` (migration 0010)
-- let an admin insert a payment row directly — bypassing rpc_record_payment's
-- own overpayment check and its auto-transition-to-paid logic entirely, the
-- exact bypass this rule exists to prevent. rpc_record_payment is
-- security definer and needs no policy of its own to write; removing this one
-- makes the RPC the only way in, same as bills/bill_lines already are.
drop policy if exists payments_insert on public.payments;

comment on column public.bills.idempotency_key is
  'Client-generated, from the Create Bill button. NULL for any bill created before this column existed.';
comment on column public.payments.idempotency_key is
  'Client-generated, from the Record Payment dialog.';
