-- 20261124400001 / 20261124400002 — stock and inventory fixes.
--
-- APX-03: no signed-in role can SELECT inventory_items.unit_cost (a column
-- privilege), a Site Supervisor reads no stock_movements row (admin-only), yet
-- site still reads quantities — from the base table, v_inventory_site and
-- rpc_inventory_stats — and an admin still reads cost through
-- v_inventory_status. APX-34: a direct inventory insert must start at zero.
-- Shape of the new RPCs. Like 12_inventory_stats_search_test.sql this
-- simulates the caller's JWT with set_config, because the policies read the
-- claim; the behavioural RPC tests run from real SDK sessions in
-- tests/integration/stock-and-inventory-fixes.test.ts.
--
-- Seeded (supabase/seed.sql): org a0, project c1 (site d5 and client d6 are
-- members), admin d2, cement item …601 in c1.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ── shape ────────────────────────────────────────────────────────────────────
select ok(
  'cancelled' = any(enum_range(null::public.stock_request_status)::text[]),
  'stock_request_status has a cancelled value'
);
select has_column('public', 'stock_requests', 'cancelled_reason', 'stock_requests.cancelled_reason exists');
select has_column('public', 'stock_requests', 'split_from_id', 'stock_requests.split_from_id exists');
select has_column('public', 'v_inventory_site', 'updated_at', 'v_inventory_site carries updated_at for the low-stock bell');

select is_empty(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name in ('v_inventory_site', 'v_stock_request_site')
        and column_name in ('unit_cost', 'stock_value', 'rate', 'billed_on_bill_id') $$,
  'the site views still carry no money column'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('rpc_create_stock_request', 'rpc_transition_stock_request')),
  2,
  'exactly one rpc_create_stock_request and one rpc_transition_stock_request — no ambiguous overloads'
);

select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('rpc_edit_stock_request', 'rpc_set_stock_request_rate', 'rpc_set_inventory_reorder_level',
                          'rpc_record_stock_usage', 'rpc_withdraw_approval', 'rpc_inventory_stats')
        and (not p.prosecdef or not ('search_path=""' = any(p.proconfig))) $$,
  'every new or changed RPC is security definer with an empty search_path'
);

select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee in ('anon', 'PUBLIC')
        and r.routine_name in ('rpc_edit_stock_request', 'rpc_set_stock_request_rate', 'rpc_set_inventory_reorder_level',
                               'rpc_record_stock_usage', 'rpc_withdraw_approval', 'rpc_create_stock_request',
                               'rpc_transition_stock_request') $$,
  'none of them is executable by anon or PUBLIC'
);

select is(
  (select count(distinct r.routine_name)::int from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'authenticated'
        and r.routine_name in ('rpc_edit_stock_request', 'rpc_set_stock_request_rate', 'rpc_set_inventory_reorder_level',
                               'rpc_record_stock_usage', 'rpc_withdraw_approval')),
  5,
  'all five new RPCs are executable by authenticated'
);

-- ── APX-03: the column privilege ─────────────────────────────────────────────
select ok(
  not has_column_privilege('authenticated', 'public.inventory_items', 'unit_cost', 'SELECT'),
  'authenticated cannot SELECT inventory_items.unit_cost'
);
select ok(
  not has_column_privilege('anon', 'public.inventory_items', 'unit_cost', 'SELECT'),
  'anon cannot SELECT inventory_items.unit_cost'
);
select is_empty(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'inventory_items' and column_name <> 'unit_cost'
        and not has_column_privilege('authenticated', 'public.inventory_items', column_name, 'SELECT') $$,
  'every other inventory_items column is granted — a new column must be granted (or deliberately withheld) by its migration'
);
select ok(
  (select pg_get_expr(p.polqual, p.polrelid) like '%is_admin%'
          and pg_get_expr(p.polqual, p.polrelid) not like '%site%'
     from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'stock_movements' and p.polcmd = 'r'),
  'the stock_movements select policy is admin-only'
);
select ok(
  (select pg_get_expr(p.polwithcheck, p.polrelid) like '%qty_on_hand = %0%'
     from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'inventory_items' and p.polcmd = 'a'),
  'inventory_insert requires qty_on_hand = 0 (APX-34)'
);
select ok(
  (select exists (select 1 from pg_index x join pg_class i on i.oid = x.indexrelid
                   where i.relname = 'inventory_sku_uq' and x.indisunique and x.indpred is not null))
  and not exists (select 1 from pg_constraint where conname = 'inventory_sku_uq'),
  'inventory_sku_uq is a partial unique index over rows with a SKU, not a table constraint'
);

-- ── fixture: a movement as the migration owner, before switching role ────────
insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, reason)
values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000601',
        '00000000-0000-4000-8000-0000000000c1', 'in', 1, 395, 'adjustment', 'pgtap 15 fixture');

set local role authenticated;

-- ── site (d5) ────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_ok(
  $$ select name, unit_cost from public.inventory_items $$,
  '42501',
  null,
  'APX-03: a site session asking for unit_cost is refused outright'
);
select ok(
  (select count(*)::int from public.inventory_items where project_id = '00000000-0000-4000-8000-0000000000c1') >= 8,
  'site still reads its project''s item rows (names, quantities) from the base table'
);
select is(
  (select count(*)::int from public.stock_movements),
  0,
  'APX-03: site reads no row of stock_movements'
);
select is(
  (select count(*)::int from public.v_inventory_status),
  0,
  'v_inventory_status (admin, carries cost) gives site nothing'
);
select ok(
  (select count(*)::int from public.v_inventory_site where project_id = '00000000-0000-4000-8000-0000000000c1') >= 8,
  'site still reads its project''s quantities through v_inventory_site'
);
select is(
  (select stock_status from public.v_inventory_site where id = '00000000-0000-4000-8000-000000000603'),
  'critical',
  'v_inventory_site still derives stock_status'
);
select ok(
  (select total_items from public.rpc_inventory_stats('00000000-0000-4000-8000-0000000000c1')) >= 8,
  'site still gets inventory tiles from rpc_inventory_stats'
);

-- ── client (d6) ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select is(
  (select count(*)::int from public.v_inventory_site),
  0,
  'a client member reads nothing from v_inventory_site (it used to rely on membership alone)'
);
select is(
  (select count(*)::int from public.inventory_items),
  0,
  'a client reads nothing from inventory_items'
);

-- ── admin (d2) ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select ok(
  (select count(*)::int from public.v_inventory_status where unit_cost > 0 and stock_value is not null) >= 8,
  'an admin still reads unit_cost and stock_value through v_inventory_status'
);
select ok(
  (select count(*)::int from public.stock_movements where reason = 'pgtap 15 fixture') = 1,
  'an admin still reads stock_movements'
);
select ok(
  (select total_value from public.rpc_inventory_stats('00000000-0000-4000-8000-0000000000c1')) > 0,
  'an admin still gets total_value from rpc_inventory_stats'
);

-- APX-34: a direct insert with stock on hand is refused; at zero it is allowed.
select throws_ok(
  $$ insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'pgtap 15 stocked', 'bag', 5) $$,
  '42501',
  null,
  'APX-34: an admin cannot insert an item with stock and no ledger row'
);
select lives_ok(
  $$ insert into public.inventory_items (org_id, project_id, name, unit, qty_on_hand)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'pgtap 15 empty', 'bag', 0) $$,
  'APX-34: an admin may still insert an item at zero, then adjust its opening balance'
);

-- A cancelled request always records when (sr_cancel_ck).
reset role;
select throws_ok(
  $$ update public.stock_requests set status = 'cancelled'
      where id = (select id from public.stock_requests where status = 'pending' limit 1) $$,
  '23514',
  null,
  'sr_cancel_ck: a cancelled request without cancelled_at is refused'
);

select * from finish();
rollback;
