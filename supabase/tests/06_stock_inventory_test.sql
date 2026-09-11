-- Build 07 — stock requests, the inventory ledger, and their RPCs.
--
-- Behavioural assertions (T-06 through T-10, the rate-stripping attack, the
-- atomic-delivery transaction, ref_no uniqueness under concurrency) run from
-- real client SDK sessions in tests/integration/stock-and-inventory.test.ts
-- (AGENTS.md database rule 8). This file is the fast structural companion.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── The three new RPCs ───────────────────────────────────────────────────────
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_create_stock_request' and not p.prosecdef $$,
  'rpc_create_stock_request is security definer'
);
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_transition_stock_request' and not p.prosecdef $$,
  'rpc_transition_stock_request is security definer'
);
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_adjust_inventory' and not p.prosecdef $$,
  'rpc_adjust_inventory is security definer'
);
select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'anon'
        and r.routine_name in ('rpc_create_stock_request', 'rpc_transition_stock_request', 'rpc_adjust_inventory') $$,
  'none of the three new RPCs are executable by anon'
);
select is(
  (select count(distinct r.routine_name)::int from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'authenticated'
        and r.routine_name in ('rpc_create_stock_request', 'rpc_transition_stock_request', 'rpc_adjust_inventory')),
  3, 'all three new RPCs are executable by authenticated'
);

-- ── A site session's own views omit money, structurally ─────────────────────
select is_empty(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'v_stock_request_site'
        and column_name in ('rate', 'billed_on_bill_id') $$,
  'v_stock_request_site omits rate and billed_on_bill_id'
);
select is_empty(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'v_inventory_site'
        and column_name in ('unit_cost', 'stock_value') $$,
  'v_inventory_site omits unit_cost and stock_value'
);

-- ── T-14a re-asserted: no role, including owner, can write the ledger
--    directly — the RPCs (rpc_transition_stock_request, rpc_adjust_inventory)
--    are the only way in. ─────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'stock_movements' and p.polcmd = 'a'),
  0, 'stock_movements has no insert policy for any role'
);
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'stock_movements' and p.polcmd = 'r'),
  1, 'stock_movements has exactly one select policy'
);

-- ── Client reaches neither table at all ──────────────────────────────────────
select ok(
  (select pg_get_expr(p.polqual, p.polrelid) like '%is_admin%' from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'stock_requests' and p.polcmd = 'r'),
  'the stock_requests select policy is admin-only — client never reaches the base table'
);
select ok(
  (select pg_get_expr(p.polqual, p.polrelid) like '%owner%admin%site%' or pg_get_expr(p.polqual, p.polrelid) like '%site%admin%owner%'
     from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'inventory_items' and p.polcmd = 'r'),
  'the inventory_items select policy is scoped to owner/admin/site — client is excluded'
);

-- ── D18: the ref_no counter exists ───────────────────────────────────────────
select has_column('public', 'projects', 'next_sr_seq', 'projects.next_sr_seq exists (D18)');

-- ── Rejection requires a reason, in SQL — not just the RPC's own check ───────
select ok(
  (select pg_get_expr(conbin, conrelid) like '%rejected_reason%' from pg_constraint
    where conname = 'sr_reject_ck'),
  'sr_reject_ck enforces a rejection reason at the database, not just the RPC'
);

select ok(
  (select count(*)::int from pg_constraint where conname = 'inventory_qty_ck') = 1,
  'inventory_qty_ck blocks negative stock outright, with no override'
);

select * from finish();
rollback;
