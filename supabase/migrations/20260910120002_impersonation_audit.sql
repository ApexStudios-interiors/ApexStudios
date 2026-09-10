-- 0018 — impersonation audit RPC
--
-- D20, build/03-auth-and-rbac.md §2.9. fn_audit (migration 0002) stays an
-- internal helper — exposing it directly to `authenticated` would let anyone
-- forge an audit_log row for any entity with a fabricated before/after payload.
-- This is a thin, purpose-built wrapper: it can only ever write one specific
-- kind of entry, and it re-checks is_admin() itself rather than trusting the
-- caller — the application-level ownerAction/adminAction guard in
-- lib/safe-action.ts is not this function's only line of defence.
--
-- p_project_ref is `text`, not a `projects.id` foreign key. The mock
-- AppContext project ids ("bhel") still flow through the UI until Build 04
-- replaces them with real project rows (the same seam recorded against
-- app/(app)/projects/[projectId]/layout.tsx) — this column will hold a real
-- uuid, as text, once that lands.
create or replace function public.rpc_log_impersonation(
  p_action text,          -- 'start' or 'stop'
  p_previewed_role text,  -- 'client' or 'site'
  p_project_ref text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only owner/admin may impersonate';
  end if;
  if p_action not in ('start', 'stop') then
    raise exception 'VALIDATION: p_action must be start or stop';
  end if;

  perform public.fn_audit(
    'session',
    auth.uid(),
    'impersonate_' || p_action,
    null,
    jsonb_build_object('previewed_role', p_previewed_role, 'project_ref', p_project_ref)
  );
end;
$$;

revoke execute on function public.rpc_log_impersonation(text, text, text) from public, anon;
grant execute on function public.rpc_log_impersonation(text, text, text) to authenticated;
