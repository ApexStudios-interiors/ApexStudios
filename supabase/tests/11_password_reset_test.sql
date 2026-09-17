-- rpc_record_password_reset (D52): the database's own check of who may reset
-- whom, and the audit row it writes. Like 03_auth_test.sql this simulates the
-- caller's JWT with set_config, because the function reads auth.uid() and
-- auth_role() from the claim; it is not an RLS policy test.
--
-- Seeded (supabase/seed.sql): owner d1, admins d2 and d3, site d5, client d6,
-- all in org a0.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ── shape ────────────────────────────────────────────────────────────────────
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_record_password_reset'),
  'rpc_record_password_reset is security definer'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_record_password_reset' and grantee in ('anon', 'PUBLIC') $$,
  'rpc_record_password_reset is not executable by anon or PUBLIC'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_record_password_reset'
      and pg_get_function_identity_arguments(p.oid) = 'p_target_id uuid'),
  1,
  'rpc_record_password_reset takes only the target id — no password argument exists'
);

-- Fixtures, as the migration owner, before switching role.
update public.profiles set is_active = false where id = '00000000-0000-4000-8000-0000000000d6';

set local role authenticated;

-- ── admin (d2) ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d1') $$,
  'FORBIDDEN%',
  'admin → owner is refused'
);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d3') $$,
  'FORBIDDEN%',
  'admin → another admin is refused'
);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d2') $$,
  'FORBIDDEN%',
  'admin → self is refused'
);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d6') $$,
  'FORBIDDEN%',
  'a deactivated target is refused'
);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000ff') $$,
  'NOT_FOUND%',
  'an unknown target is not found'
);

select lives_ok(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d5') $$,
  'admin → site is allowed'
);

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'profile' and entity_id = '00000000-0000-4000-8000-0000000000d5'
      and action = 'password_reset' and actor_id = '00000000-0000-4000-8000-0000000000d2'
      and actor_role = 'admin' and after = jsonb_build_object('target_role', 'site')),
  1,
  'the audit row names actor, actor role, target and target role — and nothing else'
);

-- ── owner (d1) ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d1',
  'app_metadata', json_build_object('app_role', 'owner', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select lives_ok(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d2') $$,
  'owner → admin is allowed'
);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d1') $$,
  'FORBIDDEN%',
  'owner → self is refused'
);

-- ── another org ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d1',
  'app_metadata', json_build_object('app_role', 'owner', 'org_id', '00000000-0000-4000-8000-00000000ffff')
)::text, true);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d5') $$,
  'NOT_FOUND%',
  'an owner of another org cannot find the target'
);

-- ── non-admin callers ────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d6') $$,
  'FORBIDDEN%',
  'a site user cannot reset anyone'
);

reset role;

-- A soft-deleted target, as the owner again.
update public.profiles set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000d5';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d1',
  'app_metadata', json_build_object('app_role', 'owner', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ select public.rpc_record_password_reset('00000000-0000-4000-8000-0000000000d5') $$,
  'NOT_FOUND%',
  'a soft-deleted target is not found'
);

reset role;

select is(
  (select count(*)::int from public.audit_log where action = 'password_reset'
     and created_at >= now()),
  2,
  'exactly the two allowed resets were audited'
);

select * from finish();
rollback;
