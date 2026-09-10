-- Auth hook and helper-function assertions. build/03-auth-and-rbac.md §3.1.
--
-- is_member_of()/is_admin() are plain boolean functions, not policies, so
-- exercising them via a simulated JWT claim (set_config) tests the function's
-- own logic directly. This is distinct from AGENTS.md database rule 8, which
-- is about RLS POLICY enforcement — that stays client-SDK-only, in
-- tests/integration/. Nothing here asserts a policy is enforced; it asserts
-- what these two functions return given a claim.

begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- ── the hook itself ──────────────────────────────────────────────────────────
select isnt_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'custom_access_token_hook' $$,
  'custom_access_token_hook exists'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'custom_access_token_hook'
        and grantee in ('authenticated', 'anon', 'PUBLIC') $$,
  'custom_access_token_hook is not executable by authenticated, anon or PUBLIC'
);

select isnt_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'custom_access_token_hook' and grantee = 'supabase_auth_admin' $$,
  'custom_access_token_hook IS executable by supabase_auth_admin — otherwise GoTrue could never call it'
);

-- ── is_member_of() / is_admin() as pure functions ────────────────────────────
-- Simulate each role's JWT claim rather than authenticating as a real user —
-- this isolates the function's own branching from any specific seeded account.
set local role authenticated;

select set_config(
  'request.jwt.claims',
  json_build_object('app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0'))::text,
  true
);
select ok(public.is_admin(), 'is_admin() is true for an admin claim');
select ok(
  public.is_member_of('00000000-0000-4000-8000-0000000000c1'),
  'is_member_of() is true for an admin claim, with no project_members row at all — 02-lld.md §3.2'
);

select set_config(
  'request.jwt.claims',
  json_build_object('app_metadata', json_build_object('app_role', 'owner', 'org_id', '00000000-0000-4000-8000-0000000000a0'))::text,
  true
);
select ok(public.is_admin(), 'is_admin() is true for an owner claim too (D8: owner is a superset of admin)');

select set_config(
  'request.jwt.claims',
  json_build_object('app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0'))::text,
  true
);
select ok(not public.is_admin(), 'is_admin() is false for a site claim');

-- Ravi (site) has a real project_members row on the seeded project.
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000d5',
                     'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0'))::text,
  true);
select ok(
  public.is_member_of('00000000-0000-4000-8000-0000000000c1'),
  'is_member_of() is true for a site user with an actual project_members row'
);

-- A fabricated project id has no membership row for anyone but admin/owner.
select ok(
  not public.is_member_of('00000000-0000-4000-8000-000000000000'),
  'is_member_of() is false for a site user on a project they are not a member of'
);

reset role;

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_log_impersonation'
        and not p.prosecdef $$,
  'rpc_log_impersonation is security definer'
);

select * from finish();
rollback;
