-- Change a user's role, and deactivate / reactivate a user (migration
-- 20260918090001). Like 03_auth_test.sql and 11_password_reset_test.sql this
-- simulates the caller's JWT with set_config, because the rule is read from
-- auth.uid() and auth_role(); it is not only an RLS policy test.
--
-- Two things are being asserted here, and the second is the point:
--   1. the RPCs refuse the calls they should, and audit the ones they allow;
--   2. a DIRECT update to profiles — the PostgREST PATCH that needs no RPC —
--      meets exactly the same rule, because it lives in a trigger on the table.
--
-- Seeded (supabase/seed.sql): owner d1, admins d2 and d3, site d5, client d6,
-- all in org a0.

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ── shape ────────────────────────────────────────────────────────────────────
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_set_user_role'),
  'rpc_set_user_role is security definer'
);

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_set_user_active'),
  'rpc_set_user_active is security definer'
);

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_revoke_user_sessions'),
  'rpc_revoke_user_sessions is security definer'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name in ('rpc_set_user_role', 'rpc_set_user_active', 'rpc_revoke_user_sessions')
        and grantee in ('anon', 'PUBLIC') $$,
  'none of the three functions is executable by anon or PUBLIC'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_revoke_user_sessions' and grantee = 'authenticated' $$,
  'rpc_revoke_user_sessions is service_role only — no signed-in user may end another user''s sessions'
);

select ok(
  (select count(*) = 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'profiles'
     and t.tgname = 'trg_profiles_privilege_guard' and not t.tgisinternal),
  'the privilege guard is a trigger on profiles, so it covers a direct PATCH too'
);

set local role authenticated;

-- ── admin (d2) through the RPCs ──────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d1', 'site') $$,
  'FORBIDDEN%',
  'admin → owner role change is refused'
);

select throws_like(
  $$ select public.rpc_set_user_active('00000000-0000-4000-8000-0000000000d1', false) $$,
  'FORBIDDEN%',
  'admin → owner deactivation is refused'
);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d3', 'site') $$,
  'FORBIDDEN%',
  'admin → another admin is refused'
);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d2', 'site') $$,
  'FORBIDDEN%',
  'admin → self is refused'
);

select throws_like(
  $$ select public.rpc_set_user_active('00000000-0000-4000-8000-0000000000d2', false) $$,
  'FORBIDDEN%',
  'nobody deactivates themselves'
);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000ff', 'site') $$,
  'NOT_FOUND%',
  'an unknown target is not found'
);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d5', 'owner') $$,
  'FORBIDDEN%',
  'the owner role cannot be assigned'
);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d5', 'site') $$,
  'ILLEGAL_TRANSITION%',
  'a no-op role change is refused rather than audited as a change'
);

select lives_ok(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d5', 'admin') $$,
  'admin → site is allowed'
);

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'profile' and entity_id = '00000000-0000-4000-8000-0000000000d5'
      and action = 'role_changed' and actor_id = '00000000-0000-4000-8000-0000000000d2'
      and actor_role = 'admin'
      and before = jsonb_build_object('role', 'site')
      and after = jsonb_build_object('role', 'admin')),
  1,
  'the audit row names actor, actor role, target and the before/after role'
);

-- d5 is an admin now, so the same caller may no longer touch it.
select throws_like(
  $$ select public.rpc_set_user_active('00000000-0000-4000-8000-0000000000d5', false) $$,
  'FORBIDDEN%',
  'the rule is read from the target''s CURRENT role, not the one it had a moment ago'
);

-- ── deactivate / reactivate (admin → client d6) ──────────────────────────────
select lives_ok(
  $$ select public.rpc_set_user_active('00000000-0000-4000-8000-0000000000d6', false) $$,
  'admin → client deactivation is allowed'
);

select is(
  (select count(*)::int from public.audit_log
    where entity_type = 'profile' and entity_id = '00000000-0000-4000-8000-0000000000d6'
      and action = 'user_deactivated' and actor_id = '00000000-0000-4000-8000-0000000000d2'
      and before = jsonb_build_object('is_active', true, 'role', 'client')
      and after = jsonb_build_object('is_active', false, 'role', 'client')),
  1,
  'the deactivation audit row carries the before/after flag and the target role'
);

select throws_like(
  $$ select public.rpc_set_user_active('00000000-0000-4000-8000-0000000000d6', false) $$,
  'ILLEGAL_TRANSITION%',
  'deactivating an already deactivated user is refused'
);

select lives_ok(
  $$ select public.rpc_set_user_active('00000000-0000-4000-8000-0000000000d6', true) $$,
  'a deactivated user can be reactivated — deactivation is not a delete'
);

-- ── non-admin callers, and the direct-PATCH path ─────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d5', 'site') $$,
  'FORBIDDEN%',
  'a client cannot change anyone''s role'
);

-- profiles_update_self (migration 0003) permits this UPDATE. The trigger is
-- what refuses it — without it, any signed-in user could promote themselves.
select throws_like(
  $$ update public.profiles set role = 'owner'
      where id = '00000000-0000-4000-8000-0000000000d6' $$,
  'FORBIDDEN%',
  'a direct PATCH promoting yourself is refused by the trigger, not only by the RPC'
);

-- profiles_update_admin permits this one for any admin in the org.
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ update public.profiles set is_active = false
      where id = '00000000-0000-4000-8000-0000000000d1' $$,
  'FORBIDDEN%',
  'a direct PATCH deactivating the owner is refused by the trigger'
);

-- ── another org ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d1',
  'app_metadata', json_build_object('app_role', 'owner', 'org_id', '00000000-0000-4000-8000-00000000ffff')
)::text, true);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d6', 'site') $$,
  'NOT_FOUND%',
  'an owner of another org cannot find the target'
);

reset role;

-- ── a soft-deleted target ────────────────────────────────────────────────────
update public.profiles set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000d6';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d1',
  'app_metadata', json_build_object('app_role', 'owner', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_like(
  $$ select public.rpc_set_user_role('00000000-0000-4000-8000-0000000000d6', 'site') $$,
  'NOT_FOUND%',
  'a soft-deleted target is not found'
);

reset role;

-- ── the last active owner ────────────────────────────────────────────────────
-- As the migration role: auth.uid() is null, so the who-may-do-what rule does
-- not apply — but the org invariant does, for every role there is.
select throws_like(
  $$ update public.profiles set is_active = false
      where id = '00000000-0000-4000-8000-0000000000d1' $$,
  'FORBIDDEN: the last active owner%',
  'the last active owner cannot be deactivated, even by the backend role'
);

select throws_like(
  $$ update public.profiles set role = 'admin'
      where id = '00000000-0000-4000-8000-0000000000d1' $$,
  'FORBIDDEN: the last active owner%',
  'the last active owner cannot be demoted'
);

select throws_like(
  $$ update public.profiles set deleted_at = now()
      where id = '00000000-0000-4000-8000-0000000000d1' $$,
  'FORBIDDEN: the last active owner%',
  'the last active owner cannot be soft-deleted either'
);

-- Ownership handover, the only supported order: promote the successor first.
update public.profiles set role = 'owner' where id = '00000000-0000-4000-8000-0000000000d3';

select lives_ok(
  $$ update public.profiles set role = 'admin'
      where id = '00000000-0000-4000-8000-0000000000d1' $$,
  'with a second active owner in the org, the first may be demoted'
);

select * from finish();
rollback;
