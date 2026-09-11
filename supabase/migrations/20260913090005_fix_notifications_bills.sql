-- 0030 — fix v_notifications: bill_submitted returned zero rows for Client
--
-- build/07-stock-inventory-notifications.md §2.6, D33 (docs/decisions.md).
--
-- v_notifications is `security_invoker = on` (0015's own comment: "each
-- branch reads a table whose own policy already scopes it correctly"). That
-- assumption is false for `bills`: the only select policy on the base table
-- is `bills_select_admin` (0010), which requires `is_admin()` — there is no
-- policy granting a Client select on `public.bills` at all. Client-facing
-- reads go through `v_bill_client` (0014), a `security_invoker = off` view
-- that does its own `is_member_of()` scoping specifically because no RLS
-- policy on the base table covers a Client.
--
-- The practical effect: a Client session querying v_notifications directly
-- from `public.bills` got RLS-filtered to zero rows before `for_roles` was
-- ever checked, so a Client never saw "Bill RA-... awaiting certification" —
-- exactly the notification that matters most, since AGENTS.md's own rule is
-- "Only a Client may certify a bill". This was silent: no error, just an
-- empty branch, and it predates this build (0015).
--
-- Fix: read `v_bill_client` instead of `public.bills`. `is_member_of()`
-- returns true unconditionally for `is_admin()` (0002), so Owner/Admin still
-- see every org bill exactly as before — this is not a second branch with a
-- narrower for_roles, it is a strict widening for Client with no change in
-- behaviour for anyone else.
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
  'Computed live; no notification table, no read state (ADR-014). The bill_submitted branch reads v_bill_client, not public.bills directly — the base table has no Client select policy at all (D33). The inventory branch reads inventory_items directly rather than v_inventory_status, so it does not drag unit_cost through a union that non-admins read.';
