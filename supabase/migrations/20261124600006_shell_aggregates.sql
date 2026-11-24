-- APX-52 — the admin portfolio's money totals are computed in SQL, not by
-- summing an unpaged (1,000-row-capped) select in JavaScript floats.
--
-- (The bell's unread count deliberately stays in the application. The
-- v_notifications audience rule — for_roles, a per-profile audience, preview
-- scoping — belongs to the notifications work (D72) and lives in
-- features/notifications/service.ts; a second copy of it in SQL would drift.)
--
-- ── rpc_portfolio_money ──────────────────────────────────────────────────────
-- getPortfolioForAdmin pulled every v_package_rollup row for the portfolio and
-- added allocated/internal/committed with `Number(...)`. Past 1,000 packages
-- the totals were silently short, and the sums were binary floating point
-- (AGENTS.md database rule 3 is about storage, but the same reasoning applies
-- to a figure printed on the Admin dashboard). This returns one row per
-- project plus one grand-total row (project_id null), each amount numeric
-- summed in Postgres and returned as TEXT so it crosses PostgREST without
-- passing through a JSON double.
--
-- security INVOKER: it reads v_package_rollup, itself invoker-mode over the
-- admin-only packages policy, so a non-admin caller gets no package rows (and
-- a zero total) — the money boundary is the base table's RLS, exactly as for
-- the select it replaces.
create or replace function public.rpc_portfolio_money(p_project_ids uuid[])
returns table (project_id uuid, allocated text, internal text, committed text)
language sql stable security invoker
set search_path = ''
as $$
  select r.project_id,
         coalesce(sum(r.allocated_amount), 0)::text,
         coalesce(sum(r.internal_amount), 0)::text,
         coalesce(sum(r.committed), 0)::text
    from public.v_package_rollup r
   where r.project_id = any(p_project_ids)
   group by grouping sets ((r.project_id), ());
$$;

revoke execute on function public.rpc_portfolio_money(uuid[]) from public, anon;
grant execute on function public.rpc_portfolio_money(uuid[]) to authenticated;
