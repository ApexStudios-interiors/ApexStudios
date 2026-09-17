-- 0049 — project codes are generated, not typed
--
-- The New Project dialog no longer asks the admin to type a code. The app
-- derives a base from the project name (features/projects/service.ts —
-- 'BHEL Nagnar Club House' -> 'BHEL-NCH', the seeded convention) and the
-- database makes it unique.
--
-- Uniqueness is decided HERE, not in the app, for two reasons:
--
--   1. projects_code_uq is unique (org_id, code) across EVERY row, soft-deleted
--      ones included — but projects_select hides soft-deleted rows. An app-side
--      "is this code taken?" read through the user's RLS-scoped client cannot
--      see them, so it would hand out a code the insert then rejects.
--   2. Two admins creating projects with the same name at the same moment would
--      both be told the same code is free. rpc_create_project retries on a
--      projects_code_uq violation instead.
--
-- The code is embedded in every bill number forever (D6), so it is decided once
-- at insert and never regenerated.

-- ── fn_next_project_code ─────────────────────────────────────────────────────
-- First free code for p_base within p_org_id: the base itself, then BASE-2,
-- BASE-3, … The base is re-normalised to exactly what projects_code_ck accepts
-- (upper-case alphanumeric groups joined by single hyphens, 3-20 chars), so a
-- caller cannot push the insert into a check-constraint failure.
--
-- Security definer because it must see soft-deleted rows RLS hides. Not
-- callable by any API role: it takes an arbitrary org id, and answering "is
-- this code used in that org?" for someone else's org is an oracle. Only the
-- two rpc_* functions below call it, and they pass auth_org().
create or replace function public.fn_next_project_code(p_org_id uuid, p_base text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_base      text;
  v_suffix    text;
  v_candidate text;
  v_n         int := 1;
begin
  v_base := upper(coalesce(p_base, ''));
  v_base := regexp_replace(v_base, '[^A-Z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := rtrim(left(v_base, 20), '-');
  if v_base = '' then
    v_base := 'PRJ';
  end if;
  if length(v_base) < 3 then
    v_base := rpad(v_base, 3, 'X');
  end if;

  loop
    if v_n = 1 then
      v_candidate := v_base;
    else
      v_suffix := '-' || v_n::text;
      v_candidate := rtrim(left(v_base, 20 - length(v_suffix)), '-') || v_suffix;
    end if;

    exit when not exists (
      select 1 from public.projects p
       where p.org_id = p_org_id
         and p.code = v_candidate
    );
    v_n := v_n + 1;
  end loop;

  return v_candidate;
end;
$$;

revoke execute on function public.fn_next_project_code(uuid, text) from public, anon, authenticated;

-- ── rpc_next_project_code ────────────────────────────────────────────────────
-- Read-only preview for the dialog, so the admin sees the code before creating.
-- It is a preview: rpc_create_project decides again inside its own transaction,
-- and a project created in between moves the real one to the next suffix.
create or replace function public.rpc_next_project_code(p_base text)
returns text
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only owner/admin may create a project';
  end if;
  return public.fn_next_project_code(public.auth_org(), p_base);
end;
$$;

revoke execute on function public.rpc_next_project_code(text) from public, anon;
grant execute on function public.rpc_next_project_code(text) to authenticated;

-- ── rpc_create_project ───────────────────────────────────────────────────────
-- Same signature as migration 0020 (so no drop, and the grant carries over).
-- p_code is now the BASE the code is generated from, not the final code: an
-- unused base is kept exactly as given, a used one gets the next numeric suffix.
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
  v_org_id     uuid;
  v_code       text;
  v_attempt    int := 0;
  v_constraint text;
  v_seq        int := 1;
  v_name       text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: only owner/admin may create a project';
  end if;

  v_org_id := public.auth_org();

  loop
    v_code := public.fn_next_project_code(v_org_id, p_code);
    begin
      insert into public.projects (org_id, client_id, code, name, location, start_date, created_by)
      values (v_org_id, p_client_id, v_code, p_name, p_location, p_start_date, auth.uid())
      returning id into v_project_id;
      exit;
    exception when unique_violation then
      -- A concurrent create committed this exact code between the lookup and
      -- the insert. Look again (the committed row is now visible) and retry.
      -- Anything other than the code constraint is not ours to swallow.
      get stacked diagnostics v_constraint = constraint_name;
      v_attempt := v_attempt + 1;
      if v_constraint is distinct from 'projects_code_uq' or v_attempt >= 5 then
        raise;
      end if;
    end;
  end loop;

  foreach v_name in array p_package_names loop
    insert into public.packages (org_id, project_id, seq_no, name, created_by)
    values (v_org_id, v_project_id, v_seq, v_name, auth.uid());
    v_seq := v_seq + 1;
  end loop;

  perform public.fn_audit(
    'project', v_project_id, 'insert', null,
    jsonb_build_object('name', p_name, 'code', v_code, 'package_count', array_length(p_package_names, 1))
  );

  return v_project_id;
end;
$$;

revoke execute on function public.rpc_create_project(text, uuid, text, text, date, text[]) from public, anon;
grant execute on function public.rpc_create_project(text, uuid, text, text, date, text[]) to authenticated;
