-- 0041 — an admin may reset the OWNER's password (D65)
--
-- Widens the rule migration 20260917110001 set, by owner decision on
-- 2026-09-28, after testing established that a forgotten owner password was
-- unrecoverable through the product:
--
--   * an admin was refused the owner (that migration's own rule);
--   * an owner was refused themselves (D52);
--   * a SECOND owner could never exist, because
--     fn_guard_profile_privilege_change raises 'the owner role cannot be
--     assigned' for every promotion to owner (D8).
--
-- Three doors shut on one account with no locksmith. The owner chose this
-- door having been told the cost plainly: ANY ADMIN CAN NOW RESET THE OWNER'S
-- PASSWORD AND SIGN IN AS THEM. The previous version of this function named
-- that as privilege escalation and refused it; it is now permitted by
-- decision, not by oversight. The audit row is written BEFORE the password
-- changes, so it records the attempt — it does not prevent it.
--
-- NOT widened: an admin still may not reset ANOTHER ADMIN, declined
-- separately by the same decision. The rule is deliberately asymmetric —
-- admin -> site, client, owner, but not a peer admin.
--
-- Unchanged, and taken verbatim from the live definition so nothing else can
-- drift: the self-reset refusal, the org scoping through auth_org(), the
-- deactivated check, the audit row, and the use of auth_role() (the REAL role
-- from the JWT, so a D20 preview can never widen anyone's rights).

CREATE OR REPLACE FUNCTION public.rpc_record_password_reset(p_target_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- D65: 'owner' added. An admin may reset a site user, a client, or the
  -- owner — but still not another admin.
  if v_caller_role = 'admin' and v_target_role not in ('site', 'client', 'owner') then
    raise exception 'FORBIDDEN: an admin may reset only site, client and owner users';
  end if;

  perform public.fn_audit(
    'profile',
    p_target_id,
    'password_reset',
    null,
    jsonb_build_object('target_role', v_target_role)
  );
end;
$function$;

revoke execute on function public.rpc_record_password_reset(uuid) from public, anon;
grant execute on function public.rpc_record_password_reset(uuid) to authenticated;
