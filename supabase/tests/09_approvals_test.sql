-- Build 08 — client approvals and sign-off.
--
-- Behavioural assertions (rpc_decide_approval's FORBIDDEN cases for
-- owner/admin/site, a non-member client refused, all three roles reading
-- their own project's approvals, the attachments freeze on decision) run
-- from real client SDK sessions in tests/integration/approvals.test.ts
-- (AGENTS.md database rule 8 — 02-lld.md §6.3 test 6 is exactly this kind
-- of assertion, and the SQL editor bypasses RLS entirely). This file is the
-- fast structural companion.

begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

-- ── The two new RPCs ─────────────────────────────────────────────────────────
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_create_approval' and not p.prosecdef $$,
  'rpc_create_approval is security definer'
);
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_decide_approval' and not p.prosecdef $$,
  'rpc_decide_approval is security definer'
);
select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name in ('rpc_create_approval', 'rpc_decide_approval') and grantee = 'anon' $$,
  'neither new RPC is executable by anon'
);
select is(
  (select count(distinct routine_name)::int from information_schema.role_routine_grants
    where routine_name in ('rpc_create_approval', 'rpc_decide_approval') and grantee = 'authenticated'),
  2,
  'both new RPCs are executable by authenticated'
);

-- ── No update policy anywhere — the RPC is the only way in ───────────────────
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'approvals' and cmd = 'UPDATE' $$,
  'approvals has no update policy for any role — rpc_decide_approval is the only way a decision is recorded'
);

-- ── The role-scoping this build's own guardrail depends on ───────────────────
select is_empty(
  $$ select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'approvals'
        and column_name in ('internal_amount', 'internal_cost_amount', 'unit_cost', 'rate', 'margin_amount') $$,
  'approvals carries no cost or margin column at all — build §2.4''s own reason every role reads the same shape'
);

-- ── Database-level constraints (migration 0008, predates this build; never
--    directly asserted until now) ──────────────────────────────────────────
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'ap_reject_ck' $$,
  'ap_reject_ck enforces a rejection reason at the database, not just the RPC'
);
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'ap_decided_ck' $$,
  'ap_decided_ck makes "pending with a decided_at" and "decided with no decided_at" both impossible'
);
select isnt_empty(
  $$ select 1 from pg_constraint where conname = 'ap_ref_uq' $$,
  'ap_ref_uq: ref_no is unique per org, the same guard next_ap_seq''s row lock exists to satisfy'
);

-- ── D-series follow-through ───────────────────────────────────────────────────
select isnt_empty(
  $$ select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'projects' and column_name = 'next_ap_seq' $$,
  'projects.next_ap_seq exists'
);

-- ── D35/D33's own bug class, checked once more up front rather than after
--    the fact: does anything here read a base table another role's session
--    couldn't reach? approvals itself has a single select policy scoped by
--    membership, not admin — every role reads it directly, no view needed.
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'approvals' and cmd = 'SELECT'
      and qual !~ 'is_member_of' $$,
  'the approvals select policy is gated on membership, not admin — every role reads it directly'
);

select * from finish();
rollback;
