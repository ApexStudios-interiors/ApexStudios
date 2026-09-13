-- Build 09 — the billing engine.
--
-- Behavioural assertions (T-05 admin FORBIDDEN from certifying, a client
-- refused from creating a bill, overpayment refused, part-payment
-- accumulation, the double-billing guard, etc.) run from real client SDK
-- sessions in tests/integration/billing.test.ts (AGENTS.md database rule 8
-- — the SQL editor and a privileged connection both bypass RLS and would
-- report a broken policy as working). This file is the fast structural
-- companion.

begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ── The three new RPCs ───────────────────────────────────────────────────────
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_create_bill' and not p.prosecdef $$,
  'rpc_create_bill is security definer'
);
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_transition_bill' and not p.prosecdef $$,
  'rpc_transition_bill is security definer'
);
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_record_payment' and not p.prosecdef $$,
  'rpc_record_payment is security definer'
);
select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name in ('rpc_create_bill', 'rpc_transition_bill', 'rpc_record_payment')
        and grantee = 'anon' $$,
  'none of the three new RPCs are executable by anon'
);
select is(
  (select count(distinct routine_name)::int from information_schema.role_routine_grants
    where routine_name in ('rpc_create_bill', 'rpc_transition_bill', 'rpc_record_payment')
      and grantee = 'authenticated'),
  3,
  'all three new RPCs are executable by authenticated'
);

-- ── No insert/update policy anywhere — the RPCs are the only way in ─────────
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'bills' and cmd in ('INSERT', 'UPDATE') $$,
  'bills has no insert or update policy for any role — rpc_create_bill/rpc_transition_bill are the only paths in'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'bill_lines' and cmd in ('INSERT', 'UPDATE', 'DELETE') $$,
  'bill_lines has no insert/update/delete policy for any role'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'bill_events' and cmd != 'SELECT' $$,
  'no role can insert, update or delete bill_events directly — append-only via fn_audit-adjacent RPC writes only'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'payments' and cmd = 'INSERT' $$,
  'payments has no direct insert policy — D11: rpc_record_payment is the only way in (0041 removed the original one)'
);

-- ── Column isolation (HLD §7 Layer 2) ────────────────────────────────────────
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'bills' and cmd = 'SELECT'
      and qual !~ 'is_admin' $$,
  'the bills select policy is admin-only — a site or client session gets zero rows, never the internal block'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'bill_lines' and cmd = 'SELECT'
      and qual !~ 'is_admin' $$,
  'the bill_lines select policy is admin-only too'
);
select is_empty(
  $$ select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'v_bill_client'
        and column_name in ('internal_cost_amount', 'margin_amount') $$,
  'v_bill_client carries neither internal_cost_amount nor margin_amount — the entire internal block, not just hidden in the UI'
);
select is_empty(
  $$ select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'v_bill_line_client'
        and column_name in ('internal_cost', 'source_id') $$,
  'v_bill_line_client carries neither internal_cost nor source_id'
);

-- ── Database-level constraints ────────────────────────────────────────────────
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'bills_no_uq' $$,
  'bills_no_uq: bill_no is unique per org'
);
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'bills_seq_uq' $$,
  'bills_seq_uq: seq_no is unique per project, the row lock is what makes it gapless'
);
select isnt_empty(
  $$ select 1 from pg_indexes where indexname = 'idx_bill_lines_source' $$,
  'idx_bill_lines_source: THE double-billing guard — a phase or delivered material appears on exactly one bill line'
);
select isnt_empty(
  $$ select 1 from pg_indexes where indexname = 'bills_idem_uq' $$,
  'bills_idem_uq: a double-clicked Create Bill cannot produce two RA bills'
);
select isnt_empty(
  $$ select 1 from pg_indexes where indexname = 'payments_idem_uq' $$,
  'payments_idem_uq: the Record Payment dialog''s own idempotency guard'
);
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'payments_amt_ck' $$,
  'payments_amt_ck: a payment amount must be positive'
);

-- ── D-series follow-through ───────────────────────────────────────────────────
select isnt_empty(
  $$ select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'mobilisation_recovery_pct' $$,
  'projects.mobilisation_recovery_pct exists (build §0.2/§4.1 step 6)'
);

select isnt_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_enqueue_job' and grantee = 'authenticated' $$,
  'rpc_enqueue_job is still callable by authenticated after the bill.pdf whitelist extension (0043)'
);

select * from finish();
rollback;
