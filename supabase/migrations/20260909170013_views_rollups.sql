-- 0013 — rollup views
--
-- 02-lld.md §4.1.
--
-- SECURITY MODEL FOR THIS FILE: every view here is `security_invoker = on`.
-- These views expose internal_amount, committed, remaining and margin, so they
-- must inherit the base tables' admin-only policies rather than bypass them.
-- A definer view here would hand cost data to any authenticated session.
--
-- The role-scoped views in 0014 are the opposite case and are deliberately
-- definer views; see the comment there.

create view public.v_package_rollup
with (security_invoker = on) as
select
  p.id                                        as package_id,
  p.project_id,
  p.allocated_amount,
  p.internal_amount,
  coalesce(c.committed, 0)                    as committed,
  p.internal_amount - coalesce(c.committed, 0) as remaining,
  case when p.internal_amount > 0
       then round(coalesce(c.committed, 0) / p.internal_amount * 100, 2)
       else 0 end                             as used_pct,
  coalesce(t.progress, 0)                     as progress_pct,
  (p.internal_amount > 0 and coalesce(c.committed, 0) > p.internal_amount) as is_over_budget
from public.packages p
left join lateral (
  select sum(sr.qty * coalesce(sr.rate, 0)) as committed
    from public.stock_requests sr
   where sr.package_id = p.id
     and sr.status in ('approved', 'ordered', 'delivered')
     and sr.deleted_at is null
) c on true
left join lateral (
  -- Duration-weighted mean, so a 3-week task at 100% and a 1-week task at 0%
  -- give 75%, not 50%.
  select case when sum(tk.duration_weeks) > 0
              then round(sum(tk.duration_weeks * tk.progress_pct)::numeric
                         / sum(tk.duration_weeks), 0)
              else 0 end as progress
    from public.tasks tk
   where tk.package_id = p.id and tk.deleted_at is null
) t on true
where p.deleted_at is null;

comment on view public.v_package_rollup is
  'Admin-only. Carries internal_amount, committed, remaining and used_pct. security_invoker=on so the admin-only policy on packages applies. Non-admins use v_package_client / v_package_site.';

-- ─────────────────────────────────────────────────────────────────────────────
create view public.v_phase_billing
with (security_invoker = on) as
select
  ph.id as phase_id,
  ph.project_id,
  ph.package_id,
  ph.name,
  ph.allocated_amount,
  ph.internal_amount,
  ph.billing_status,
  count(tk.id)                                      as task_count,
  count(tk.id) filter (where tk.progress_pct = 100)  as tasks_done,
  (   (count(tk.id) > 0 and count(tk.id) = count(tk.id) filter (where tk.progress_pct = 100))
   or ph.manual_complete_at is not null )            as is_complete
from public.phases ph
left join public.tasks tk on tk.phase_id = ph.id and tk.deleted_at is null
where ph.deleted_at is null
-- Grouping by the primary key alone is legal because every other selected
-- column is functionally dependent on it. Do not copy this to a non-PK grouping.
group by ph.id;

comment on view public.v_phase_billing is
  'Admin-only. Carries internal_amount. is_complete is derived, never stored.';

-- ─────────────────────────────────────────────────────────────────────────────
create view public.v_inventory_status
with (security_invoker = on) as
select
  i.*,
  case when i.qty_on_hand = 0                then 'critical'
       when i.qty_on_hand < i.reorder_level  then 'low'
       else 'ok' end                          as stock_status,
  round(i.qty_on_hand * i.unit_cost, 2)       as stock_value
from public.inventory_items i
where i.deleted_at is null;

comment on view public.v_inventory_status is
  'Owner/admin/site. Carries unit_cost and stock_value, so never reachable by a client. stock_status is derived here rather than stored, because a stored status goes stale the moment a movement lands.';

grant select on public.v_package_rollup to authenticated;
grant select on public.v_phase_billing to authenticated;
grant select on public.v_inventory_status to authenticated;
