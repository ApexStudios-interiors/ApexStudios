-- Security hardening (audit 2026-11-24, APX-09): the role-scoped views check
-- the ROLE, not only membership
--
-- The views in 0014 (and 0019/0021/0022) are definer views: they read the
-- admin-only base tables as their owner and hand back the columns a role may
-- see. Their only row guard was is_member_of(project_id) — and a site
-- supervisor and a client are both members. So a site session could read
-- v_bill_client (every bill total: money, which site must never see) and
-- v_package_client / v_phase_client (contract values); a client could read
-- v_stock_request_site and v_inventory_site (site-only stock data) and every
-- DRAFT bill, figures included, before anyone had sent it. docs/decisions.md
-- records the bill case as confirmed live and, until now, fixed only in the
-- application layer (each query filtered by role or by status itself).
--
-- Each view keeps its exact column list (create or replace view cannot change
-- it, and nothing reading it should notice); only the WHERE clause changes:
--
--   v_package_client, v_phase_client     admin or client
--   v_bill_client, v_bill_line_client    admin, or a client — and a client
--                                        only once the bill has been SENT
--                                        (status <> 'draft' and submitted_at
--                                        set). That hides an unsent draft and
--                                        a never-submitted cancelled draft; a
--                                        bill the client rejected back to
--                                        draft is hidden until it is
--                                        resubmitted, exactly as the
--                                        application already shows it.
--   v_stock_request_site, v_inventory_site
--                                        admin or site. v_inventory_site also
--                                        gains org_id = auth_org(): its
--                                        central-store rows (project_id null)
--                                        matched every organisation.
--
-- Deliberately NOT narrowed: v_package_site and v_phase_site. Despite the
-- name they are "the money-free package/phase lists", and clients read them on
-- purpose — Schedule, Approvals, Daily Updates and search all show a client
-- package and phase NAMES through them (features/*/queries.ts). They carry no
-- money (01_policy_matrix_test asserts it). v_client_name is likewise for
-- every member.
--
-- Admin is unaffected everywhere — including "preview as": a preview is the
-- admin's own JWT, and is_admin() passes every predicate below.
--
-- The notifications bell keeps working: v_notifications (security_invoker)
-- reads v_bill_client for bill_submitted (for_roles admin, client) and
-- v_stock_request_site for stock_request (for_roles admin, site) — exactly
-- the roles these views now admit.
--
-- ── projects: contract_value and the mobilisation figures ────────────────────
-- projects_select admits every member, and RLS cannot hide a column, so a
-- site session could read contract_value, mobilisation_advance and
-- mobilisation_recovered straight off projects. Column privileges are per
-- DATABASE role and every app role is `authenticated`, so: authenticated keeps
-- SELECT on every other column of projects, loses it on those three, and reads
-- them through v_project_finance — admin, or a client on their own project.
-- None of the three is internal cost: contract_value is what the client is
-- charged, and the mobilisation advance is the client's own payment, recovered
-- on their invoices.
--
-- ⚠ A new column on projects is NOT readable by authenticated until it is
-- granted (Postgres does not extend a column-level grant). 15_security_
-- hardening_test asserts the exact set, so a forgotten grant fails CI rather
-- than a page. UPDATE is untouched: an admin still edits contract_value
-- through updateProject, under projects_update.

-- ── Packages / phases, client side ───────────────────────────────────────────
create or replace view public.v_package_client
with (security_invoker = off) as
select
  id,
  project_id,
  seq_no,
  name,
  lead_profile_id,
  allocated_amount as contract_value,
  status,
  progress_pct
from public.packages
where deleted_at is null
  and public.is_member_of(project_id)
  and (public.is_admin() or public.auth_role() = 'client');

create or replace view public.v_phase_client
with (security_invoker = off) as
select
  ph.id,
  ph.project_id,
  ph.package_id,
  ph.seq_no,
  ph.name,
  ph.allocated_amount as contract_value,
  ph.billing_status,
  ( (t.task_count > 0 and t.task_count = t.tasks_done) or ph.manual_complete_at is not null ) as is_complete
from public.phases ph
left join lateral (
  select count(*) as task_count, count(*) filter (where tk.progress_pct = 100) as tasks_done
  from public.tasks tk
  where tk.phase_id = ph.id and tk.deleted_at is null
) t on true
where ph.deleted_at is null
  and public.is_member_of(ph.project_id)
  and (public.is_admin() or public.auth_role() = 'client');

-- ── Bills, client side ───────────────────────────────────────────────────────
create or replace view public.v_bill_client
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
where b.deleted_at is null
  and public.is_member_of(b.project_id)
  and (
    public.is_admin()
    or (public.auth_role() = 'client' and b.status <> 'draft' and b.submitted_at is not null)
  );

create or replace view public.v_bill_line_client
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
where b.deleted_at is null
  and public.is_member_of(b.project_id)
  and (
    public.is_admin()
    or (public.auth_role() = 'client' and b.status <> 'draft' and b.submitted_at is not null)
  );

-- ── Stock, site side ─────────────────────────────────────────────────────────
create or replace view public.v_inventory_site
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
  and i.org_id = public.auth_org()
  and (i.project_id is null or public.is_member_of(i.project_id))
  and (public.is_admin() or public.auth_role() = 'site');

create or replace view public.v_stock_request_site
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
where sr.deleted_at is null
  and public.is_member_of(sr.project_id)
  and (public.is_admin() or public.auth_role() = 'site');

comment on view public.v_package_client is
  'Client-facing (admin or client only — APX-09). OMITS internal_amount, committed, remaining, used_pct, margin, is_over_budget.';
comment on view public.v_phase_client is
  'Client-facing (admin or client only — APX-09). OMITS internal_amount. is_complete computed inline against tasks (see 20260910180004).';
comment on view public.v_bill_client is
  'Client-facing (admin, or a client once the bill has been sent — APX-09). OMITS internal_cost_amount and margin_amount.';
comment on view public.v_bill_line_client is
  'Client-facing (admin, or a client once the bill has been sent — APX-09). OMITS internal_cost and source_id.';
comment on view public.v_inventory_site is
  'Site-facing (admin or site only, own org — APX-09). OMITS unit_cost and stock_value.';
comment on view public.v_stock_request_site is
  'Site-facing (admin or site only — APX-09). OMITS rate and billed_on_bill_id.';

-- ── projects: the three money columns move behind a view ─────────────────────
create view public.v_project_finance
with (security_invoker = off) as
select
  p.id,
  p.contract_value,
  p.mobilisation_advance,
  p.mobilisation_recovered
from public.projects p
where p.deleted_at is null
  and public.is_member_of(p.id)
  and (public.is_admin() or public.auth_role() = 'client');

comment on view public.v_project_finance is
  'contract_value and the mobilisation figures, for admin or a client on their own project (APX-09). Site has no path to them: authenticated has no SELECT on those three columns of projects.';

revoke all on public.v_project_finance from anon;
grant select on public.v_project_finance to authenticated;

revoke select on public.projects from anon, authenticated;
grant select (
  id, org_id, client_id, code, name, location, status, start_date, target_end_date,
  gst_rate_pct, retention_pct, mas_billable_pct, tds_pct, mobilisation_recovery_pct,
  progress_pct, next_bill_seq, next_sr_seq, next_ap_seq, rate_visibility,
  created_at, created_by, updated_at, updated_by, deleted_at, completed_at
) on public.projects to authenticated;
