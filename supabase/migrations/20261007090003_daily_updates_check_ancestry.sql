-- daily_updates: enforce project → package ancestry
--
-- The same gap 20261007090001 (approvals) and 20261007090002 (stock_requests)
-- closed. daily_updates.package_id → packages is a single-column foreign key:
-- it proves the package EXISTS, not that it belongs to the update's project.
-- du_insert checks membership, role, author and org, but not the package — so
-- an update in project A could be filed under a package of project B, and
-- nothing refused it. The web dialog never builds such a row (its package list
-- is the project's), but the table is writable by every member through
-- PostgREST directly, and a mobile route is about to post updates too.
--
-- So the rule lives on the table, as trg_approvals_check_ancestry and
-- trg_stock_requests_check_ancestry do: every insert, and every update that
-- moves a row's project or package, whichever path it came by.
--
--   package_id must belong to project_id. package_id is NOT NULL here, so
--   there is no optional case to skip.
--   Soft-deleted packages are NOT refused here, matching the approval and
--   stock-request rules; out of scope.
--
-- Errors use the domain convention (NOT_FOUND:, errcode P0002), the same
-- message as the other two ancestry triggers, so lib/safe-action.ts
-- mapDomainError shows "That record no longer exists."
--
-- SECURITY DEFINER for the reason 20260911090002 found: packages are
-- admin-only on select, so under a site caller's RLS the lookup below would
-- see nothing and refuse a perfectly valid row. The function only reads one
-- id to validate the write; it returns no data.
--
-- Only the columns named in the trigger fire it: editDailyUpdate (body,
-- updated_by) never does.
--
-- Not changed: RLS policies, any application code.

create or replace function public.trg_daily_updates_check_ancestry()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_package_project_id uuid;
begin
  select pk.project_id into v_package_project_id
    from public.packages pk where pk.id = new.package_id;

  if v_package_project_id is null or v_package_project_id <> new.project_id then
    raise exception 'NOT_FOUND: package % does not exist in this project', new.package_id
      using errcode = 'P0002';
  end if;

  return new;
end;
$$;

create trigger trg_daily_updates_ancestry
  before insert or update of project_id, package_id
  on public.daily_updates
  for each row execute function public.trg_daily_updates_check_ancestry();
