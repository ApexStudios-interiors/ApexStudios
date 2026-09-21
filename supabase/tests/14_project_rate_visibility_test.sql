-- projects.rate_visibility and the rate rule inside rpc_create_stock_request
-- (migration 20260921090001, D55).
--
-- UNRUN. There is exactly one Supabase project and it is production (D49), so
-- `pnpm test:rls` has no target today and refuses to run; this file is written
-- to be run the moment a non-production database exists, and has never been
-- executed. Nothing here has been observed passing.
--
-- Seeded (supabase/seed.sql): owner d1, admin d2, site d5, org a0.

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ── shape ────────────────────────────────────────────────────────────────────
select has_column('public', 'projects', 'rate_visibility',
  'projects has a rate_visibility column');

select col_not_null('public', 'projects', 'rate_visibility',
  'rate_visibility is NOT NULL');

select col_default_is('public', 'projects', 'rate_visibility', 'hidden',
  'rate_visibility defaults to hidden — nothing changes until a project is switched on');

select has_check('public', 'projects',
  'projects has a check constraint (projects_rate_visibility_ck)');

-- The three modes, and only the three modes.
select lives_ok(
  $$ update public.projects set rate_visibility = 'readonly'
      where id = (select id from public.projects order by code limit 1) $$,
  'readonly is an accepted mode'
);
select lives_ok(
  $$ update public.projects set rate_visibility = 'editable'
      where id = (select id from public.projects order by code limit 1) $$,
  'editable is an accepted mode'
);
select throws_ok(
  $$ update public.projects set rate_visibility = 'visible'
      where id = (select id from public.projects order by code limit 1) $$,
  '23514',
  null,
  'an unknown mode is rejected by the check constraint'
);

-- ── the rate rule still lives in the RPC ─────────────────────────────────────
-- The Server Action strips `rate` before the call, but the security definer
-- function is the real write path, so the rule has to be decided here too.
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_create_stock_request'),
  'rpc_create_stock_request is still security definer'
);

select ok(
  (select pg_get_functiondef(p.oid) like '%rate_visibility%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_create_stock_request'),
  'rpc_create_stock_request consults the project rate_visibility for a site caller'
);

select * from finish();
rollback;
