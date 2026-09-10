-- 0025 — projects.completed_at
--
-- build/06-files-jobs-daily-updates.md's project.archive job (01-hld.md
-- §10.2: "Archive projects closed > 12 months") needs a reliable timestamp of
-- WHEN a project became 'completed' — `updated_at` does not do: any later
-- edit (fixing the contract value, say) would push it forward and delay
-- archiving on a signal that has nothing to do with completion. This is a
-- trigger-maintained cache of a status transition, the same exception
-- AGENTS.md carves out for `progress_pct` — not a value the application
-- computes and could let go stale.

alter table public.projects add column completed_at timestamptz;

create or replace function public.trg_projects_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    new.completed_at := now();
  elsif new.status is distinct from 'completed' then
    -- Reopened after being marked complete — archiving should not fire on a
    -- stale timestamp from a status the project no longer holds.
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger trg_projects_completed_at before update on public.projects
  for each row execute function public.trg_projects_completed_at();
