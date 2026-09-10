-- 0020 — rpc_create_project
--
-- build/04-projects-packages-phases.md §4.1: "createProject creates the
-- project AND its named packages in one RPC or one transaction, so a failure
-- halfway does not leave a project with two of its four packages." The
-- Supabase client cannot give this across separate .insert() calls — each is
-- its own transaction over PostgREST — so this is the one write in this build
-- that genuinely needs an RPC. Every other package/phase write (create,
-- update) is a plain, single-row, RLS-gated call through the client; a simple
-- UPDATE ... WHERE id = x AND updated_at = y is already atomic as one SQL
-- statement and needs no RPC of its own.
create or replace function public.rpc_create_project(
  p_name text,
  p_client_id uuid,
  p_code text,
  p_location text,
  p_start_date date,
  p_package_names text[] default '{}'
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_org_id uuid;
  v_seq int := 1;
  v_name text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only owner/admin may create a project';
  end if;

  v_org_id := public.auth_org();

  insert into public.projects (org_id, client_id, code, name, location, start_date, created_by)
  values (v_org_id, p_client_id, p_code, p_name, p_location, p_start_date, auth.uid())
  returning id into v_project_id;

  foreach v_name in array p_package_names loop
    insert into public.packages (org_id, project_id, seq_no, name, created_by)
    values (v_org_id, v_project_id, v_seq, v_name, auth.uid());
    v_seq := v_seq + 1;
  end loop;

  perform public.fn_audit(
    'project', v_project_id, 'insert', null,
    jsonb_build_object('name', p_name, 'code', p_code, 'package_count', array_length(p_package_names, 1))
  );

  return v_project_id;
end;
$$;

revoke execute on function public.rpc_create_project(text, uuid, text, text, date, text[]) from public, anon;
grant execute on function public.rpc_create_project(text, uuid, text, text, date, text[]) to authenticated;
