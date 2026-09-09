-- 0014 — role-scoped views: column isolation
--
-- 02-lld.md §4.3, HLD §7 Layer 2. This is the file the product's core promise
-- rests on.
--
-- THE RULE, and it is absolute:
--   If a column would be a permission violation for that role, it does not
--   appear in the view's select list. Not null. Not zero. ABSENT.
--
-- SECURITY MODEL FOR THIS FILE: every view here is `security_invoker = off`,
-- a definer view. That is deliberate and it is the opposite of 0013. The base
-- tables (packages, phases, bills, stock_requests, inventory_items) are
-- admin-only on select because they carry cost columns. A client or site session
-- cannot read them at all. These views run as their owner, so they CAN read the
-- base table, and they hand back only the columns that role may see. The row
-- guard is the `public.is_member_of(...)` clause inside each view.
--
-- ⚠ This design depends on the spike recorded as D15 in docs/decisions.md:
--   `force row level security` makes RLS apply to the table owner too, and a
--   definer view executes as the view's owner. If the owner is subject to the
--   base table's admin-only policy, these views return zero rows to a client and
--   the Packages table renders silently empty. The spike must be run against a
--   real database before this file is trusted. If it fails, D15 records which of
--   the three amendments was taken and 02-lld.md §4.3 is amended to match.

-- ── Packages, as the client sees them ────────────────────────────────────────
create view public.v_package_client
with (security_invoker = off) as
select
  id,
  project_id,
  seq_no,
  name,
  lead_profile_id,
  allocated_amount as contract_value,   -- renamed: it is what they are charged
  status,
  progress_pct
from public.packages
where deleted_at is null and public.is_member_of(project_id);

comment on view public.v_package_client is
  'Client-facing. OMITS internal_amount, committed, remaining, used_pct, margin, is_over_budget. Adding any of them here is a client-visible margin leak. See 01-hld.md §7 Layer 2.';

-- ── Packages, as the site supervisor sees them ───────────────────────────────
-- Site sees no money at all, not even the client-facing figure.
create view public.v_package_site
with (security_invoker = off) as
select
  p.id,
  p.project_id,
  p.seq_no,
  p.name,
  p.lead_profile_id,
  p.status,
  p.progress_pct,
  (select count(*) from public.stock_requests sr
    where sr.package_id = p.id and sr.status = 'pending' and sr.deleted_at is null)
    as open_requests,
  (select count(*) from public.phases ph
    where ph.package_id = p.id and ph.deleted_at is null)
    as phase_count
from public.packages p
where p.deleted_at is null and public.is_member_of(p.project_id);

comment on view public.v_package_site is
  'Site-facing. OMITS allocated_amount AND internal_amount and every derived money column. A site supervisor sees quantities, schedule and status — no money at all (01-hld.md §3).';

-- ── Phases, as the client sees them ──────────────────────────────────────────
create view public.v_phase_client
with (security_invoker = off) as
select
  ph.id,
  ph.project_id,
  ph.package_id,
  ph.seq_no,
  ph.name,
  ph.allocated_amount as contract_value,
  ph.billing_status,
  (   (vb.task_count > 0 and vb.task_count = vb.tasks_done)
   or ph.manual_complete_at is not null ) as is_complete
from public.phases ph
join public.v_phase_billing vb on vb.phase_id = ph.id
where ph.deleted_at is null and public.is_member_of(ph.project_id);

comment on view public.v_phase_client is
  'Client-facing. OMITS internal_amount. billing_status is shown because the client needs to know what has been billed; the cost behind it is not.';

-- ── Bills, as the client sees them ───────────────────────────────────────────
create view public.v_bill_client
with (security_invoker = off) as
select
  b.id,
  b.project_id,
  b.seq_no,
  b.bill_no,
  b.bill_date,
  b.period_from,
  b.period_to,
  b.status,
  b.revision,
  b.work_value,
  b.material_value,
  b.gross_amount,
  b.mas_recovery_amount,
  b.taxable_amount,
  b.gst_amount,
  b.invoice_total,
  b.retention_amount,
  b.tds_amount,
  b.advance_recovery,
  b.net_payable,
  b.gst_rate_pct,
  b.retention_pct,
  b.tds_pct,
  b.notes,
  b.submitted_at,
  b.certified_at,
  b.certified_by,
  b.certification_note,
  b.paid_at,
  b.created_at
from public.bills b
where b.deleted_at is null and public.is_member_of(b.project_id);

comment on view public.v_bill_client is
  'Client-facing. OMITS internal_cost_amount and margin_amount — the entire internal block. Every other figure on this view is on the tax invoice the client receives, so withholding it would be pointless; the margin is not.';

-- ── Bill lines, as the client sees them ──────────────────────────────────────
create view public.v_bill_line_client
with (security_invoker = off) as
select
  bl.id,
  bl.bill_id,
  bl.source_type,
  bl.description,
  bl.client_value,
  bl.pct_billed,
  bl.amount,
  bl.sort_order
from public.bill_lines bl
join public.bills b on b.id = bl.bill_id
where b.deleted_at is null and public.is_member_of(b.project_id);

comment on view public.v_bill_line_client is
  'Client-facing. OMITS internal_cost and source_id. source_id is withheld because it identifies the exact phase or stock request behind the line, which lets a determined client correlate cost across bills.';

-- ── Inventory, as the site supervisor sees it ────────────────────────────────
create view public.v_inventory_site
with (security_invoker = off) as
select
  i.id,
  i.project_id,
  i.name,
  i.category,
  i.sku,
  i.unit,
  i.qty_on_hand,
  i.reorder_level,
  i.location,
  case when i.qty_on_hand = 0               then 'critical'
       when i.qty_on_hand < i.reorder_level then 'low'
       else 'ok' end as stock_status
from public.inventory_items i
where i.deleted_at is null
  and (i.project_id is null or public.is_member_of(i.project_id));

comment on view public.v_inventory_site is
  'Site-facing. OMITS unit_cost and stock_value. A supervisor needs to know that cement is low, not what it cost.';

-- ── Stock requests, as the site supervisor sees them ─────────────────────────
create view public.v_stock_request_site
with (security_invoker = off) as
select
  sr.id,
  sr.project_id,
  sr.package_id,
  sr.phase_id,
  sr.ref_no,
  sr.inventory_item_id,
  sr.material_name,
  sr.qty,
  sr.unit,
  sr.needed_by,
  sr.note,
  sr.status,
  sr.requested_by,
  sr.approved_at,
  sr.ordered_at,
  sr.delivered_at,
  sr.rejected_reason,
  sr.created_at
from public.stock_requests sr
where sr.deleted_at is null and public.is_member_of(sr.project_id);

comment on view public.v_stock_request_site is
  'Site-facing. OMITS rate and billed_on_bill_id. rate is the internal cost per unit; billed_on_bill_id would reveal which materials have been billed and therefore that they carry a margin.';

grant select on public.v_package_client to authenticated;
grant select on public.v_package_site to authenticated;
grant select on public.v_phase_client to authenticated;
grant select on public.v_bill_client to authenticated;
grant select on public.v_bill_line_client to authenticated;
grant select on public.v_inventory_site to authenticated;
grant select on public.v_stock_request_site to authenticated;
