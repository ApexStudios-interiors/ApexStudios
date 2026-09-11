-- Build 07 — search trigram indexes and the rate limiter.
-- build/07-stock-inventory-notifications.md §2.7.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

select ok(
  (select count(*)::int from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'idx_projects_name_trgm', 'idx_packages_name_trgm', 'idx_sr_material_name_trgm',
        'idx_approvals_item_trgm', 'idx_bills_bill_no_trgm', 'idx_inventory_items_name_trgm',
        'idx_profiles_full_name_trgm'
      )) = 7,
  'all seven pg_trgm GIN indexes exist'
);

select isnt_empty(
  $$ select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'pg_trgm' and n.nspname = 'extensions' $$,
  'pg_trgm lives in the extensions schema, not public (keeps its own functions out of gen-types.mjs)'
);

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_check_rate_limit' and not p.prosecdef $$,
  'rpc_check_rate_limit is security definer'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_check_rate_limit' and grantee in ('anon', 'PUBLIC') $$,
  'rpc_check_rate_limit is not executable by anon or PUBLIC'
);

select isnt_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_check_rate_limit' and grantee = 'authenticated' $$,
  'rpc_check_rate_limit is executable by authenticated'
);

-- rate_limits has no policy at all for any role — rpc_check_rate_limit
-- (security definer) is the only path in, same as stock_movements' own
-- append-only design. A session reading or writing its own throttle counter
-- directly would just be a second way to reset it.
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'rate_limits' $$,
  'rate_limits has no RLS policy for any role'
);

select * from finish();
rollback;
