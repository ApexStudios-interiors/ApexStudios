-- Change a user's role, and deactivate / reactivate a user — the two controls
-- the Users page has rendered disabled since Build 03
-- (features/users/components/UserRoleSelect.tsx, app/(app)/users/page.tsx).
--
-- Three pieces, in order:
--
--   1. trg_profiles_privilege_guard — a BEFORE UPDATE trigger on profiles that
--      enforces who may change a role or an is_active flag, and the
--      last-active-owner invariant, on EVERY write path.
--   2. rpc_set_user_role / rpc_set_user_active — the two operations the app
--      calls. They perform the update and write the audit_log row in one
--      transaction, and they refuse a missing, soft-deleted or no-op target.
--   3. rpc_revoke_user_sessions — deletes the target's auth.sessions rows.
--      service_role only; called from lib/auth/admin.ts after the change lands.
--
-- WHY THE RULE LIVES IN A TRIGGER AND NOT ONLY IN THE RPCs
--
-- profiles already has two update policies (migration 0003):
--
--   profiles_update_self   using (id = auth.uid())
--   profiles_update_admin  using (org_id = auth_org() and is_admin())
--
-- Neither can express a column-level rule — migration 0003 says so itself and
-- defers the role column to "the RPC that sets it (Build 03)", which was never
-- built. Until now that left two open escalation paths through PostgREST,
-- reachable by anyone holding a valid access token and the anon key:
--
--   PATCH /rest/v1/profiles?id=eq.<me>     {"role":"owner"}   -- via _self
--   PATCH /rest/v1/profiles?id=eq.<owner>  {"is_active":false} -- via _admin
--
-- An RPC cannot close those, because nothing forces a caller to use it. A
-- BEFORE UPDATE trigger is enforced by the table itself, so the RPC path, a
-- direct PATCH and a future feature all meet the same rule. The RPCs are then
-- thin: they exist for the audit row, the not-found/no-op refusals, and a
-- single round trip.
--
-- WHO MAY DO WHAT (the shape of D52's password-reset rule, one row wider)
--
--   | caller | owner | admin | site | client | themselves |
--   | owner  | yes   | yes   | yes  | yes    | no         |
--   | admin  | no    | no    | yes  | yes    | no         |
--   | site / client — never, for anyone                    |
--
-- An admin may not touch the owner or another admin: demoting or deactivating
-- the owner is how an admin would lock the organisation's highest privilege out
-- of its own product, and admin → admin is the same move sideways. Nobody
-- changes their own role or deactivates themselves — a self-demotion is
-- irreversible by the person who made it, and would be the one way to strand
-- the org with no one able to put it back.
--
-- NOTE — 'owner' is not assignable by a signed-in caller at all (D8: there is
-- one owner). Promoting someone to owner is a deliberate, out-of-band act: it
-- happens through SQL as the backend role, which the guard below lets through
-- (auth.uid() is null). That is also how ownership is handed over: promote the
-- successor first, then demote the incumbent — the last-owner rule below holds
-- for the backend role too, so the two steps cannot be done in the other order.
--
-- THE LAST-OWNER INVARIANT
--
-- An org must never be left with zero active owners. The check runs inside the
-- trigger, in the same statement and transaction as the update that would
-- cause it, and takes a row lock on the org's other active owners first — so
-- two concurrent demotions cannot each see the other's owner as the spare.
-- Checking it in application code instead would be a read followed by a write
-- with a gap in between, which is exactly the race this avoids.

-- ── 1. The guard ─────────────────────────────────────────────────────────────

create or replace function public.fn_guard_profile_privilege_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_actor_role   public.app_role;
  v_changed      boolean := new.role is distinct from old.role
                            or new.is_active is distinct from old.is_active;
  v_drops_owner  boolean;
begin
  -- Would this update remove an active owner — by demotion, deactivation or
  -- soft delete? deleted_at is included because a soft delete is the third way
  -- to reach zero owners, and profiles.deleted_at is writable by the same
  -- policies as the other two columns.
  v_drops_owner := old.role = 'owner'
                   and old.is_active
                   and old.deleted_at is null
                   and (new.role <> 'owner' or not new.is_active or new.deleted_at is not null);

  -- Who may do it. No auth.uid() means no signed-in caller: the migration
  -- role, the seed, or service_role (lib/supabase/admin.ts,
  -- lib/jobs/handlers/**). Those already bypass RLS entirely, so there is no
  -- privilege here for them to gain — but the org invariant below still binds
  -- them.
  if v_changed and v_actor is not null then
    v_actor_role := public.auth_role();

    -- `v_actor_role is null` is spelled out because `null not in (…)` is null,
    -- not true, and an `if` on null does nothing — a caller whose role could
    -- not be resolved would otherwise fall straight through every test below.
    if v_actor_role is null or v_actor_role not in ('owner', 'admin') then
      raise exception 'FORBIDDEN: only owner/admin may change a role or deactivate a user';
    end if;

    if old.id = v_actor then
      raise exception 'FORBIDDEN: a user cannot change their own role or deactivate themselves';
    end if;

    if old.org_id is distinct from public.auth_org() then
      raise exception 'FORBIDDEN: that user is not in your organisation';
    end if;

    if old.deleted_at is not null then
      raise exception 'FORBIDDEN: that user has been deleted';
    end if;

    -- D8: one owner. Nobody promotes anyone to owner through the product.
    if new.role = 'owner' and new.role is distinct from old.role then
      raise exception 'FORBIDDEN: the owner role cannot be assigned';
    end if;

    if v_actor_role = 'admin' and old.role not in ('site', 'client') then
      raise exception 'FORBIDDEN: an admin may act only on site and client users';
    end if;
  end if;

  -- The org invariant, checked last so that an unauthorised call fails with
  -- its own reason, and checked for every caller — including the backend role,
  -- and including an update that only sets deleted_at.
  if v_drops_owner then
    -- for update: hold every other active owner row for the rest of this
    -- transaction. A concurrent transaction demoting one of them blocks here
    -- (or on its own row lock) and re-evaluates this predicate after the first
    -- commits, so the second one finds no spare and raises. Nothing is counted
    -- into a variable and acted on later — the lock and the test are one step.
    perform 1
       from public.profiles p
      where p.org_id = old.org_id
        and p.id <> old.id
        and p.role = 'owner'
        and p.is_active
        and p.deleted_at is null
        for update;

    if not found then
      raise exception 'FORBIDDEN: the last active owner cannot be demoted, deactivated or deleted';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_profiles_privilege_guard
  before update on public.profiles
  for each row execute function public.fn_guard_profile_privilege_change();

-- ── 2. The two operations ────────────────────────────────────────────────────
--
-- Both are security definer so that the update and the fn_audit call are one
-- transaction the caller cannot half-perform, and both re-select the target
-- `for update` first: that row lock is what makes "read the current value,
-- write the next one, audit the pair" safe against a concurrent second admin.
--
-- The authorisation rule itself is NOT repeated here. It is the trigger's, and
-- the trigger fires on the update these functions issue exactly as it fires on
-- a direct PATCH. One copy of a security rule is a rule; two copies are a
-- rule and a bug waiting to disagree with it.
--
-- Error prefixes are the ones lib/safe-action.ts's mapDomainError knows
-- (NOT_FOUND, ILLEGAL_TRANSITION, FORBIDDEN); no message carries anything but
-- a role name.

create or replace function public.rpc_set_user_role(p_target_id uuid, p_role public.app_role)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old_role public.app_role;
begin
  select p.role
    into v_old_role
    from public.profiles p
   where p.id = p_target_id
     and p.org_id = public.auth_org()
     and p.deleted_at is null
     for update;

  if not found then
    raise exception 'NOT_FOUND: user';
  end if;

  if v_old_role = p_role then
    raise exception 'ILLEGAL_TRANSITION: that user already has this role';
  end if;

  update public.profiles set role = p_role where id = p_target_id;

  perform public.fn_audit(
    'profile',
    p_target_id,
    'role_changed',
    jsonb_build_object('role', v_old_role),
    jsonb_build_object('role', p_role)
  );
end;
$$;

create or replace function public.rpc_set_user_active(p_target_id uuid, p_active boolean)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_was_active boolean;
  v_role       public.app_role;
begin
  select p.is_active, p.role
    into v_was_active, v_role
    from public.profiles p
   where p.id = p_target_id
     and p.org_id = public.auth_org()
     and p.deleted_at is null
     for update;

  if not found then
    raise exception 'NOT_FOUND: user';
  end if;

  if v_was_active = p_active then
    raise exception 'ILLEGAL_TRANSITION: that user is already in that state';
  end if;

  update public.profiles set is_active = p_active where id = p_target_id;

  perform public.fn_audit(
    'profile',
    p_target_id,
    case when p_active then 'user_reactivated' else 'user_deactivated' end,
    jsonb_build_object('is_active', v_was_active, 'role', v_role),
    jsonb_build_object('is_active', p_active, 'role', v_role)
  );
end;
$$;

-- ── 3. Session revocation ────────────────────────────────────────────────────
--
-- GoTrue has no admin endpoint that signs a user out by id: auth.admin.signOut
-- takes that user's own JWT, which the server never has. The one thing that
-- reliably ends every session — a password change (D52) — is the wrong tool
-- for a demotion, because it would also lock the user out of an account they
-- are meant to keep using.
--
-- So this deletes the rows directly. auth.refresh_tokens.session_id references
-- auth.sessions(id) on delete cascade, so the refresh tokens go with them, and:
--
--   * the browser's next refresh finds no token row and the session ends
--     (supabase/auth internal/tokens/service.go — FindUserWithRefreshToken);
--   * middleware.ts's getUser() is rejected while the access token is still
--     within its 30 minutes, because GoTrue looks up the session named by the
--     JWT's session_id claim and returns 403 session_not_found when it is gone
--     (internal/api/auth.go).
--
-- What it does NOT do is invalidate the access token itself for PostgREST,
-- which verifies the signature and `exp` and consults no session table. That
-- residual window is bounded by supabase/config.toml's jwt_expiry = 1800 — at
-- most 30 minutes of direct-to-PostgREST access with the old claims. Closing it
-- entirely would need JWT-secret rotation, which signs out every user in the
-- project. See the PR description.
--
-- The auth schema is owned by supabase_auth_admin and is not exposed over
-- PostgREST; this runs as the migration's own role (postgres), which does hold
-- delete on auth.sessions. It takes no claim into account and does no
-- authorisation of its own, so it is granted to service_role ONLY — it is
-- called from lib/auth/admin.ts, after rpc_set_user_role / rpc_set_user_active
-- have already authorised and recorded the change.

create or replace function public.rpc_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from auth.sessions s where s.user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.rpc_set_user_role(uuid, public.app_role) from public, anon;
grant  execute on function public.rpc_set_user_role(uuid, public.app_role) to authenticated;

revoke execute on function public.rpc_set_user_active(uuid, boolean) from public, anon;
grant  execute on function public.rpc_set_user_active(uuid, boolean) to authenticated;

revoke execute on function public.rpc_revoke_user_sessions(uuid) from public, anon, authenticated;
grant  execute on function public.rpc_revoke_user_sessions(uuid) to service_role;

-- fn_guard_profile_privilege_change deliberately has no grant or revoke of its
-- own. A trigger function's EXECUTE privilege is checked when the trigger is
-- created, not when it fires, so revoking it would not narrow anything; and
-- calling it directly raises "can only be called as a trigger", so leaving it
-- executable grants nobody anything. Every other trigger function in this
-- schema (trg_set_updated_at, the rollup triggers) is left the same way.
