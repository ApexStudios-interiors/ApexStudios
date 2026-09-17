-- rpc_record_password_reset — the database half of the Users page's Reset
-- password (D52).
--
-- Called by features/users/actions.ts's resetUserPassword through the CALLER's
-- RLS-scoped client, immediately BEFORE the new password is set through
-- GoTrue's admin API. It does two things, in one statement's transaction:
--
--   1. Re-checks who may reset whom, independently of the application guard
--      (the same pattern as rpc_log_impersonation, migration 0018). The role
--      it compares is auth_role(): the JWT's app_role claim, i.e. the REAL
--      role. The D20 preview is a cookie the database never sees, so an
--      owner previewing as client is still owner here, and a preview can
--      never widen anyone's rights.
--        owner  → any other live, active user in the org
--        admin  → site and client only (never the owner, never another
--                 admin: resetting the owner's password and signing in as
--                 them would be privilege escalation)
--        nobody → themselves
--   2. Writes the audit_log row: actor (auth.uid(), auth_role(), created_at
--      via fn_audit), target (entity_id), and the target's role. NO password
--      material exists here at all — the password is never an argument.
--
-- The row is written when the reset is authorised, not after GoTrue confirms
-- it, so an attempted reset is never unaudited. A GoTrue failure after this
-- point surfaces as an error to the admin, and the row then records an
-- attempt that did not change the password.
--
-- fn_audit stays internal: this wrapper can only write one kind of entry,
-- about a profile the caller is allowed to reset.
--
-- Session revocation needs no SQL: GoTrue's PUT /admin/users/{id} with a
-- password calls models.User.UpdatePassword(tx, nil), which deletes every
-- auth.sessions row for the user in the same transaction as the password
-- change (refresh_tokens cascade on session_id). See D52.

create or replace function public.rpc_record_password_reset(p_target_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_caller_role public.app_role := public.auth_role();
  v_target_role public.app_role;
  v_target_active boolean;
begin
  if auth.uid() is null or v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'FORBIDDEN: only owner/admin may reset a password';
  end if;

  if p_target_id = auth.uid() then
    raise exception 'FORBIDDEN: a user cannot reset their own password here';
  end if;

  select p.role, p.is_active
    into v_target_role, v_target_active
    from public.profiles p
   where p.id = p_target_id
     and p.org_id = public.auth_org()
     and p.deleted_at is null;

  if not found then
    raise exception 'NOT_FOUND: user';
  end if;

  if not v_target_active then
    raise exception 'FORBIDDEN: user is deactivated';
  end if;

  if v_caller_role = 'admin' and v_target_role not in ('site', 'client') then
    raise exception 'FORBIDDEN: an admin may reset only site and client users';
  end if;

  perform public.fn_audit(
    'profile',
    p_target_id,
    'password_reset',
    null,
    jsonb_build_object('target_role', v_target_role)
  );
end;
$$;

revoke execute on function public.rpc_record_password_reset(uuid) from public, anon;
grant execute on function public.rpc_record_password_reset(uuid) to authenticated;
