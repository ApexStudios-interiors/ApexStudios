-- approvals: enforce project → package → phase ancestry
--
-- rpc_create_approval checked membership, role, the item and the supersede
-- rules, but inserted p_package_id and p_phase_id unchecked. The single-column
-- foreign keys (approvals.package_id → packages, approvals.phase_id → phases)
-- only prove those rows EXIST — so an approval in project A could point at a
-- package of project B, or at a phase of another package, and nothing refused
-- it. The web dialog never builds such a row (its package and phase lists are
-- scoped to the project and package), but the RPC is executable by every
-- authenticated user directly, and ap_insert allows a direct insert into
-- public.approvals that skips the RPC entirely.
--
-- So the rule lives on the table, as trg_tasks_check_ancestry does for tasks
-- (20260909170005 / 20260911090002): every insert, and every update that moves
-- a row's project, package or phase, whichever path it came by.
--
--   1. package_id must belong to project_id.
--   2. If phase_id is set, the phase must belong to package_id AND project_id.
--      A null phase_id (phase is optional on an approval) skips these.
--   Soft-deleted packages/phases are NOT refused here — that would change
--   what an existing revision of an approval may reference; out of scope.
--
-- Errors use the domain convention (NOT_FOUND:, errcode P0002), matching the
-- RPC's own "superseded approval does not exist in this project", so
-- lib/safe-action.ts mapDomainError shows "That record no longer exists." —
-- not the tasks trigger's INVARIANT: prefix, which maps to nothing.
--
-- SECURITY DEFINER for the reason 20260911090002 found the hard way: packages
-- and phases are admin-only on select, so under a site caller's RLS the
-- lookups below would see nothing and refuse a perfectly valid row. The
-- function only reads two ids to validate the write; it returns no data.
--
-- Checked against production before writing (read-only, 2026-10-07): 10
-- approvals, 0 ancestry mismatches — adding the trigger refuses no existing row.
--
-- Not changed: rpc_create_approval, RLS policies, any application code.

create or replace function public.trg_approvals_check_ancestry()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_package_project_id uuid;
  v_phase_package_id   uuid;
  v_phase_project_id   uuid;
begin
  select pk.project_id into v_package_project_id
    from public.packages pk where pk.id = new.package_id;

  if v_package_project_id is null or v_package_project_id <> new.project_id then
    raise exception 'NOT_FOUND: package % does not exist in this project', new.package_id
      using errcode = 'P0002';
  end if;

  if new.phase_id is not null then
    select ph.package_id, ph.project_id into v_phase_package_id, v_phase_project_id
      from public.phases ph where ph.id = new.phase_id;

    if v_phase_package_id is null
       or v_phase_package_id <> new.package_id
       or v_phase_project_id <> new.project_id then
      raise exception 'NOT_FOUND: phase % does not exist in this package', new.phase_id
        using errcode = 'P0002';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_approvals_ancestry
  before insert or update of project_id, package_id, phase_id
  on public.approvals
  for each row execute function public.trg_approvals_check_ancestry();
