-- stock_requests: enforce project → package → phase ancestry
--
-- The same gap 20261007090001 closed for approvals. rpc_create_stock_request
-- checks membership, role, the material name, the quantity, the project and
-- the D55 rate rule, but inserts p_package_id and p_phase_id unchecked. The
-- single-column foreign keys (stock_requests.package_id → packages,
-- stock_requests.phase_id → phases) only prove those rows EXIST — so a
-- request in project A could point at a package of project B, or at a phase
-- of another package, and nothing refused it. The web dialog never builds
-- such a row (its package list is the project's, its phase list the
-- package's), but the RPC is executable by every authenticated user
-- directly, and a mobile route is about to call it too.
--
-- So the rule lives on the table, as trg_approvals_check_ancestry and
-- trg_tasks_check_ancestry do: every insert, and every update that moves a
-- row's project, package or phase, whichever path it came by.
--
--   1. package_id must belong to project_id.
--   2. If phase_id is set, the phase must belong to package_id AND project_id.
--      A null phase_id (phase is optional on a stock request) skips these.
--   Soft-deleted packages/phases are NOT refused here, matching the approval
--   rule; out of scope.
--
-- Errors use the domain convention (NOT_FOUND:, errcode P0002), the same
-- messages as the approval trigger, so lib/safe-action.ts mapDomainError
-- shows "That record no longer exists."
--
-- SECURITY DEFINER for the reason 20260911090002 found: packages and phases
-- are admin-only on select, so under a site caller's RLS the lookups below
-- would see nothing and refuse a perfectly valid row. The function only
-- reads two ids to validate the write; it returns no data.
--
-- Only the columns named in the trigger fire it: rpc_transition_stock_request
-- (status, approved/ordered/delivered fields, rejected_reason) never does.
--
-- Not changed: rpc_create_stock_request, rpc_transition_stock_request, RLS
-- policies, any application code.

create or replace function public.trg_stock_requests_check_ancestry()
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

create trigger trg_stock_requests_ancestry
  before insert or update of project_id, package_id, phase_id
  on public.stock_requests
  for each row execute function public.trg_stock_requests_check_ancestry();
