-- 0032 — fix v_notifications: stock_request returned zero rows for Site
--
-- build/07-stock-inventory-notifications.md §2.6, D35 (docs/decisions.md).
-- The exact same bug class as D33 (migration 20260913090005), found the same
-- way: a real Playwright run under a real Site session, not a service_role
-- check.
--
-- The `stock_request` branch read `public.stock_requests` directly. That
-- table's only select policy, `sr_select_admin` (0007), requires
-- `is_admin()` — there is no policy granting Site a select on the base table
-- at all. Site-facing reads go through `v_stock_request_site` (0014), a
-- `security_invoker = off` view that does its own `is_member_of()` scoping
-- specifically because no RLS policy on `stock_requests` covers Site.
--
-- Practical effect, confirmed live against a real Site JWT: Site never saw
-- "Pending stock request: ..." at all — the one notification that exists
-- for exactly this role (01-hld.md §11: site -> pending requests + low/
-- critical inventory) — even though the two seeded pending requests were
-- right there the whole time. `inventory_low` reads `inventory_items`
-- directly and that table DOES have a Site-inclusive select policy
-- (pgTAP 06_stock_inventory_test.sql assertion 11), which is exactly why
-- that branch worked and masked this one: a weaker assertion in this
-- build's own notifications.test.ts (`stock_request` OR `inventory_low`)
-- passed on the `inventory_low` half alone and never caught it (fixed in
-- the same commit as this migration).
--
-- Fix: read `public.v_stock_request_site` instead of `public.stock_requests`.
-- `is_member_of()` returns true unconditionally for `is_admin()` (0002), so
-- Owner/Admin still see every org stock request exactly as before — this is
-- a strict widening for Site, not a second, narrower branch. The view
-- doesn't filter by status itself, so `where status = 'pending'` still
-- applies here, unchanged.
create or replace view public.v_notifications
with (security_invoker = on) as
select
  'stock_request'                                     as kind,
  sr.id                                               as entity_id,
  sr.project_id,
  'Pending stock request: ' || sr.material_name       as title,
  '/projects/' || sr.project_id || '/stock'           as href,
  sr.created_at                                       as created_at,
  array['owner', 'admin', 'site']::public.app_role[]  as for_roles
from public.v_stock_request_site sr
where sr.status = 'pending'

union all
select
  'bill_submitted',
  b.id,
  b.project_id,
  'Bill ' || b.bill_no || ' awaiting certification',
  '/projects/' || b.project_id || '/billing',
  b.submitted_at,
  array['owner', 'admin', 'client']::public.app_role[]
from public.v_bill_client b
where b.status = 'submitted'

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
  'Computed live; no notification table, no read state (ADR-014). The stock_request branch reads v_stock_request_site, not public.stock_requests directly (D35); the bill_submitted branch reads v_bill_client, not public.bills directly (D33) — neither base table has a select policy for the role that branch exists for. The inventory branch reads inventory_items directly rather than v_inventory_status, so it does not drag unit_cost through a union that non-admins read.';
