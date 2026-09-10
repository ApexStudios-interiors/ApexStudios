-- 0017 — the custom access token hook
--
-- 02-lld.md §5.2. Stamps app_metadata.app_role and app_metadata.org_id into the
-- JWT at issue time, so auth_role()/auth_org() (migration 0002) read them from
-- the claim on every request instead of joining profiles every time.
--
-- Registering it with GoTrue is a dashboard action (Authentication -> Hooks ->
-- Customize Access Token) OR a supabase/config.toml [auth.hook.custom_access_token]
-- entry pushed via `supabase config push` — see Build 03 §2.1. It must be
-- repeated for every environment, including preview branches. This migration
-- only creates the function; it does not register it.
--
-- Not `security definer`. GoTrue invokes hooks as the `supabase_auth_admin`
-- role, which Postgres already grants read access to auth.* and (via the grant
-- below) to this function specifically — there is no privilege to borrow from a
-- definer. `set search_path = ''` is added anyway, defensively, even though the
-- AGENTS.md rule technically only binds definer functions: the body already
-- schema-qualifies everything, so this costs nothing and closes the door on a
-- future edit adding an unqualified reference.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb;
  p record;
begin
  select role, org_id into p
    from public.profiles
   where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  -- coalesce to 'site': a profile row that somehow has no role should degrade
  -- to the least-privileged one, never to an unset claim that auth_role()'s own
  -- fallback would then have to interpret.
  claims := jsonb_set(claims, '{app_metadata,app_role}', to_jsonb(coalesce(p.role::text, 'site')));
  claims := jsonb_set(claims, '{app_metadata,org_id}', to_jsonb(p.org_id::text));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- A hook that users can call is a hook users can reason about. Only GoTrue's
-- own role may invoke it.
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- GoTrue's invoking role also needs to read the table the hook queries. Without
-- this grant the hook fails closed (auth_role()'s fallback then does the same
-- table read anyway, from the request path, which is why the failure mode is
-- "slower", not "insecure" — architecture.md §8.4).
grant select on public.profiles to supabase_auth_admin;
