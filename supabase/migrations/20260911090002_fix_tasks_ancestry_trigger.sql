-- 0024 — trg_tasks_check_ancestry needs SECURITY DEFINER
--
-- Found live, not in review: a site user creating a task got
-- "NOT_FOUND: phase ... does not exist" for a phase that genuinely exists and
-- that they are a real member of the project for.
--
-- 20260909170005_packages_phases_tasks.sql's own ancestry-validation trigger
-- (its comment: "The denormalised ancestry must stay true or the RLS
-- shortcut becomes a lie") reads `phases` to check that the inserted task's
-- package_id/project_id actually belong to its phase_id. But the trigger
-- function was plain SECURITY INVOKER, and `phases` is admin-only on select
-- (phases_select_admin) — so for any site (or client, though client cannot
-- reach INSERT at all) caller, the trigger's own lookup against `phases`
-- returned nothing under RLS, and the trigger read that as "phase does not
-- exist" rather than "I'm not allowed to look". Admin never noticed because
-- admin passes phases_select_admin regardless.
--
-- SECURITY DEFINER is correct here, not a workaround: the trigger is
-- verifying a structural invariant about rows that already exist, using
-- values the client does not control directly (a lie here would corrupt the
-- RLS shortcut ancestry itself relies on) — it is not exposing phases data
-- to the caller, only using it to validate the write.
create or replace function public.trg_tasks_check_ancestry()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_package_id uuid; v_project_id uuid;
begin
  select ph.package_id, ph.project_id into v_package_id, v_project_id
    from public.phases ph where ph.id = new.phase_id;

  if v_package_id is null then
    raise exception 'NOT_FOUND: phase % does not exist', new.phase_id;
  end if;
  if new.package_id <> v_package_id or new.project_id <> v_project_id then
    raise exception
      'INVARIANT: task ancestry mismatch — phase % belongs to package %/project %, not %/%',
      new.phase_id, v_package_id, v_project_id, new.package_id, new.project_id;
  end if;
  return new;
end;
$$;
