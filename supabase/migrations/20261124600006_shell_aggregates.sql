-- APX-52 — the app shell's money totals and the bell's unread count are
-- computed in SQL, not by summing an unpaged (1,000-row-capped) select in
-- JavaScript floats.
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
-- admin-only packages policy, so a non-admin caller gets no rows — the money
-- boundary is the base table's RLS, exactly as for the select it replaces.
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

-- ── rpc_notification_unread_count ────────────────────────────────────────────
-- The bell used to fetch EVERY v_notifications row on every page render and
-- count unread in JavaScript. The dropdown now fetches only the newest few;
-- the badge needs the count over all of them, which is this. Same rule as
-- features/notifications/service.ts `isUnread`: unread when this user has no
-- receipt, or the receipt is older than the notification's created_at.
--
-- security INVOKER: v_notifications is invoker-mode and each branch's own RLS
-- scopes what the caller can see; notification_reads is own-rows-only. The
-- role argument is the EFFECTIVE (possibly previewed) role, a display filter
-- exactly as `.contains("for_roles", [role])` was — not a security boundary.
-- Receipts are keyed to auth.uid(), the real user, matching getNotifications.
create or replace function public.rpc_notification_unread_count(p_role public.app_role)
returns int
language sql stable security invoker
set search_path = ''
as $$
  select count(*)::int
    from public.v_notifications n
   where n.for_roles @> array[p_role]
     and not exists (
       select 1
         from public.notification_reads r
        where r.profile_id = auth.uid()
          and r.kind = n.kind
          and r.entity_id = n.entity_id
          and r.read_at >= n.created_at
     );
$$;

revoke execute on function public.rpc_notification_unread_count(public.app_role) from public, anon;
grant execute on function public.rpc_notification_unread_count(public.app_role) to authenticated;
