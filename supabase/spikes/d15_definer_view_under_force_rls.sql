-- SPIKE for D15. NOT a migration. Never applied by `db:push`.
--
-- Question: does a `security definer` view (security_invoker = off) still return
-- rows when the base table has `force row level security` and a policy that
-- excludes the caller?
--
-- Why it matters: 02-lld.md §6 requires `force row level security` on every
-- table, and §4.3 implements column isolation as definer views over those same
-- tables. `force` makes RLS apply to the table's OWNER as well, and a definer
-- view executes as the view's owner. If the owner is subject to the base table's
-- admin-only policy, then v_package_client returns zero rows to a client session
-- and the client's Packages table renders silently empty — the worst kind of
-- failure, because nothing errors.
--
-- Run it with: pnpm spike:d15   (scripts/spike-d15.mjs)

-- ── setup ────────────────────────────────────────────────────────────────────
create table if not exists public.spike_costs (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  public_val numeric(14,2) not null,
  secret_val numeric(14,2) not null
);

alter table public.spike_costs enable row level security;
alter table public.spike_costs force row level security;

drop policy if exists spike_costs_admin_only on public.spike_costs;
create policy spike_costs_admin_only on public.spike_costs for select to authenticated
  using ( public.is_admin() );

create or replace view public.v_spike_client
with (security_invoker = off) as
select id, project_id, public_val
from public.spike_costs
where public.is_member_of(project_id);

grant select on public.v_spike_client to authenticated;

-- ── teardown ─────────────────────────────────────────────────────────────────
-- drop view if exists public.v_spike_client;
-- drop table if exists public.spike_costs;
