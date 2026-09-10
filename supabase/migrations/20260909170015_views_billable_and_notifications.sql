-- 0015 — cost→client factor, Billable Now, notifications
--
-- 02-lld.md §4.2, §4.4, §5.3.

-- ── Cost → client factor ─────────────────────────────────────────────────────
-- Falls back phase → package → 1.0. A factor of 1.0 means "we have no margin
-- data, bill at cost", which is visibly wrong on screen — better than silently
-- inventing a margin.
create or replace function public.fn_cost_to_client_factor(p_phase_id uuid, p_package_id uuid)
returns numeric
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select case when ph.internal_amount > 0
                 then ph.allocated_amount / ph.internal_amount end
       from public.phases ph where ph.id = p_phase_id),
    (select case when pk.internal_amount > 0
                 then pk.allocated_amount / pk.internal_amount end
       from public.packages pk where pk.id = p_package_id),
    1.0
  );
$$;

-- ── Billable Now ─────────────────────────────────────────────────────────────
-- Admin-only: it carries internal_cost. security_invoker = on, so the
-- admin-only policies on phases and stock_requests apply.
create view public.v_billable_now
with (security_invoker = on) as
-- Completed phases not yet on a bill.
select
  ph.project_id,
  'phase'::public.bill_line_source as source_type,
  ph.id                            as source_id,
  pk.name || ' — ' || ph.name      as description,
  ph.allocated_amount              as client_value,
  100::numeric(6,3)                as pct_billed,
  ph.allocated_amount              as amount,
  ph.internal_amount               as internal_cost
from public.phases ph
join public.packages pk on pk.id = ph.package_id
join public.v_phase_billing vb on vb.phase_id = ph.id
where ph.deleted_at is null
  and vb.is_complete
  and ph.billing_status in ('unresolved', 'billable')
  and not exists (
    select 1 from public.bill_lines bl
     where bl.source_type = 'phase' and bl.source_id = ph.id
  )

union all

-- Delivered materials not yet billed, at mas_billable_pct as a secured advance
-- (D4, pending CA confirmation).
select
  sr.project_id,
  'material'::public.bill_line_source,
  sr.id,
  sr.material_name || ' (' || sr.qty || ' ' || sr.unit || ')',
  round(sr.qty * coalesce(sr.rate, 0) * f.factor, 2),
  pr.mas_billable_pct,
  round(sr.qty * coalesce(sr.rate, 0) * f.factor * pr.mas_billable_pct / 100, 2),
  round(sr.qty * coalesce(sr.rate, 0), 2)
from public.stock_requests sr
join public.projects pr on pr.id = sr.project_id
-- The factor is computed once per row in a lateral rather than three times
-- inline, which is what the LLD's literal transcription would have done.
cross join lateral (
  select public.fn_cost_to_client_factor(sr.phase_id, sr.package_id) as factor
) f
where sr.deleted_at is null
  and sr.status = 'delivered'
  and sr.billed_on_bill_id is null;

comment on view public.v_billable_now is
  'Admin-only. Carries internal_cost. Feeds the Billable Now table and rpc_create_bill. The `not exists` on bill_lines is a second guard behind idx_bill_lines_source: the index is what actually prevents double-billing, this just stops the row appearing.';

-- ── Notifications ────────────────────────────────────────────────────────────
-- One definition serves the bell and any future digest. Computed live, with no
-- notification table and no read state (ADR-014) — a row exists exactly as long
-- as the thing needing attention exists.
--
-- security_invoker = on: each branch reads a table whose own policy already
-- scopes it correctly. The app filters further by auth_role() = any(for_roles).
create view public.v_notifications
with (security_invoker = on) as
select
  'stock_request'                                     as kind,
  sr.id                                               as entity_id,
  sr.project_id,
  'Pending stock request: ' || sr.material_name       as title,
  '/projects/' || sr.project_id || '/stock'           as href,
  sr.created_at                                       as created_at,
  array['owner', 'admin', 'site']::public.app_role[]  as for_roles
from public.stock_requests sr
where sr.status = 'pending' and sr.deleted_at is null

union all
select
  'bill_submitted',
  b.id,
  b.project_id,
  'Bill ' || b.bill_no || ' awaiting certification',
  '/projects/' || b.project_id || '/billing',
  b.submitted_at,
  array['owner', 'admin', 'client']::public.app_role[]
from public.bills b
where b.status = 'submitted' and b.deleted_at is null

union all
select
  'approval_pending',
  a.id,
  a.project_id,
  'Approval needed: ' || a.item,
  '/projects/' || a.project_id || '/approvals',
  a.created_at,
  array['client']::public.app_role[]
from public.approvals a
where a.status = 'pending' and a.deleted_at is null

union all
select
  'inventory_low',
  i.id,
  i.project_id,
  i.name || ' is ' || (case when i.qty_on_hand = 0 then 'critical' else 'low' end),
  coalesce('/projects/' || i.project_id || '/inventory', '/inventory'),
  i.updated_at,
  array['owner', 'admin', 'site']::public.app_role[]
from public.inventory_items i
where i.deleted_at is null and i.qty_on_hand < i.reorder_level;

comment on view public.v_notifications is
  'Computed live; no notification table, no read state (ADR-014). The inventory branch reads inventory_items directly rather than v_inventory_status, so it does not drag unit_cost through a union that non-admins read.';

grant select on public.v_billable_now to authenticated;
grant select on public.v_notifications to authenticated;
