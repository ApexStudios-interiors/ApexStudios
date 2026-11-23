-- rpc_inventory_stats(p_project_id, p_search) — migration
-- 20260917120001_rpc_inventory_stats_search.sql.
--
-- The stat tiles on the Inventory page must describe the same rows the table
-- shows for a `q` search. The table's filter is features/inventory/service.ts
-- `inventorySearchFilter`; the behavioural equivalence against that exact
-- PostgREST filter, from real client sessions, is in
-- tests/integration/stock-and-inventory.test.ts. This file pins the shape
-- (one overload, invoker, search_path, grants) and the matching rules. Like
-- 11_password_reset_test.sql it simulates the caller's JWT with set_config,
-- because is_admin() and the inventory_items select policy read the claim.
--
-- Seeded (supabase/seed.sql): org a0, project c1, admin d2, site d5.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ── shape ────────────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_inventory_stats'),
  1,
  'exactly one rpc_inventory_stats — the old (uuid) overload is gone, so no call is ambiguous'
);

select is(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_inventory_stats'),
  'p_project_id uuid, p_search text',
  'rpc_inventory_stats takes (p_project_id uuid, p_search text)'
);

select is(
  (select p.pronargdefaults::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_inventory_stats'),
  2,
  'both arguments default, so existing no-arg and project-only callers keep working'
);

select ok(
  (select not p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_inventory_stats'),
  'rpc_inventory_stats is still security invoker'
);

select ok(
  (select 'search_path=""' = any(p.proconfig) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_inventory_stats'),
  'rpc_inventory_stats still pins search_path to empty'
);

select ok(
  not has_function_privilege('anon', 'public.rpc_inventory_stats(uuid, text)', 'EXECUTE'),
  'anon cannot execute rpc_inventory_stats'
);

select ok(
  has_function_privilege('authenticated', 'public.rpc_inventory_stats(uuid, text)', 'EXECUTE'),
  'authenticated can execute rpc_inventory_stats'
);

-- ── fixtures, as the migration owner, before switching role ──────────────────
-- A prefix no seeded item carries, so every count below is exact.
--
-- Each fixture carries its own SKU. KNOWN FAILURE APX-TBD (found 2026-11-23
-- when this file first ran, on CI's local stack): inventory_sku_uq is
-- `unique nulls not distinct (org_id, project_id, sku)`, so a project can hold
-- only ONE item without a SKU, and five SKU-less fixtures abort on the second
-- insert. This file is about search, not SKUs, so it sidesteps that here;
-- the bug itself is pinned by a skipped test in
-- tests/integration/stock-and-inventory.test.ts. SKUs are not searched
-- (name and category only), so they cannot change a count below.
insert into public.inventory_items (org_id, project_id, name, category, sku, unit, qty_on_hand, reorder_level, unit_cost) values
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Pgtapq M_20 grade',   null,          'T12-1', 'bag', 10, 5, 100),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Pgtapq M120 grade',   null,          'T12-2', 'bag',  2, 5, 100),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Pgtapq 100% acrylic', null,          'T12-3', 'can',  0, 5, 100),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Pgtapq back\slash',   null,          'T12-4', 'len', 10, 5, 100),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Plain widget',        'PGTAPQ cat',  'T12-5', 'nos', 10, 5, 100);

set local role authenticated;

-- ── admin (d2) ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select is(
  (select total_items::int from public.rpc_inventory_stats(p_search => 'pgtapq')),
  5,
  'matches name OR category, case-insensitively'
);

select is(
  (select total_items::int from public.rpc_inventory_stats(p_search => 'M_20')),
  1,
  '_ is literal: "M_20" does not match "M120"'
);

select is(
  (select total_items::int from public.rpc_inventory_stats(p_search => '100%')),
  1,
  '% is literal'
);

select is(
  (select total_items::int from public.rpc_inventory_stats(p_search => 'back\slash')),
  1,
  'a backslash is literal'
);

select is(
  (select total_items::int from public.rpc_inventory_stats(p_search => '*Pgtapq*')),
  5,
  '* is dropped, as inventorySearchFilter drops it'
);

select is(
  (select row(low_count, critical_count)::text from public.rpc_inventory_stats(p_search => 'pgtapq')),
  '(1,1)',
  'low and critical counts follow the search too'
);

select is(
  (select total_items from public.rpc_inventory_stats(p_project_id => null, p_search => null)),
  (select total_items from public.rpc_inventory_stats()),
  'a null search is no filter — identical to the no-argument call'
);

select is(
  (select total_value from public.rpc_inventory_stats('00000000-0000-4000-8000-0000000000c1', 'pgtapq')),
  3200.00::numeric,
  'admin still gets total_value, summed over the searched rows only'
);

-- ── site (d5) ────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select is(
  (select total_value from public.rpc_inventory_stats(p_search => 'pgtapq')),
  null::numeric,
  'site still gets a null total_value with a search (D40)'
);

select * from finish();
rollback;
