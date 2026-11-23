-- D68 (2026-11-24) — v_notifications status-change and inbox branches,
-- archived-project exclusion, the low-stock predicate, and the new
-- v_stock_request_notify view. Migration 20261124500001.
--
-- Structural assertions first, then behaviour under real role claims
-- (`set local role authenticated` + request.jwt.claims, as 12_ and 13_ do).
-- Every fixture lives inside this transaction and is rolled back.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- ── structural ──────────────────────────────────────────────────────────────
select isnt_empty(
  $$ select 1 from pg_views where schemaname = 'public' and viewname = 'v_stock_request_notify' $$,
  'v_stock_request_notify exists'
);

-- A new role-visible surface: the forbidden columns must be absent.
select is_empty(
  $$ select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'v_stock_request_notify'
        and column_name in ('rate', 'billed_on_bill_id', 'unit_cost', 'internal_amount') $$,
  'v_stock_request_notify carries no rate, no billed_on_bill_id, no cost'
);

select is(
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'v_notifications'),
  array['kind', 'entity_id', 'project_id', 'title', 'href', 'created_at', 'for_roles',
        'for_profile_id', 'for_profile_role'],
  'v_notifications keeps its seven columns in order and appends the two recipient columns'
);

select ok(
  (select reloptions::text from pg_class where oid = 'public.v_notifications'::regclass) ~ 'security_invoker=on',
  'v_notifications is still security_invoker — each source''s RLS still applies'
);

select ok(
  pg_get_viewdef('public.v_notifications'::regclass) ~ 'v_stock_request_notify'
    and pg_get_viewdef('public.v_notifications'::regclass) !~ 'from public\.stock_requests\b',
  'the new stock branches read v_stock_request_notify, never public.stock_requests (D35)'
);

-- ── fixtures, as the migration owner ────────────────────────────────────────
-- Stock requests on the seeded project/package, raised by the seeded site
-- supervisor (d5). Ref prefix SR-PGTAP- so nothing collides with the seed.
insert into public.stock_requests
  (id, org_id, project_id, package_id, ref_no, material_name, qty, unit, status, requested_by,
   approved_by, approved_at, ordered_at, delivered_by, delivered_at, rejected_reason, created_at)
values
  ('00000000-0000-4000-8000-00000a1800a1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000e1', 'SR-PGTAP-A', 'Pgtap approved grout', 1, 'bag', 'approved',
   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', now() - interval '1 day',
   null, null, null, null, now() - interval '2 days'),
  ('00000000-0000-4000-8000-00000a1800b1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000e1', 'SR-PGTAP-B', 'Pgtap ordered pump', 1, 'nos', 'ordered',
   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', now() - interval '3 days',
   now() - interval '2 days', null, null, null, now() - interval '4 days'),
  ('00000000-0000-4000-8000-00000a1800c1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000e1', 'SR-PGTAP-C', 'Pgtap delivered sand', 1, 'bag', 'delivered',
   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', now() - interval '5 days',
   now() - interval '4 days', '00000000-0000-4000-8000-0000000000d5', now() - interval '1 day', null, now() - interval '6 days'),
  ('00000000-0000-4000-8000-00000a1800d1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000e1', 'SR-PGTAP-D', 'Pgtap rejected paint', 1, 'can', 'rejected',
   '00000000-0000-4000-8000-0000000000d5', null, null, null, null, null, 'Use the leftover stock', now() - interval '3 days'),
  ('00000000-0000-4000-8000-00000a1800e1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000e1', 'SR-PGTAP-E', 'Pgtap stale approval', 1, 'bag', 'approved',
   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', now() - interval '30 days',
   null, null, null, null, now() - interval '31 days');

insert into public.stock_request_events (request_id, from_status, to_status, actor_id, note, created_at)
values ('00000000-0000-4000-8000-00000a1800d1', 'pending', 'rejected', '00000000-0000-4000-8000-0000000000d2',
        'Use the leftover stock', now() - interval '20 hours');

-- A rejected approval raised by the site supervisor, decided by the client.
insert into public.approvals
  (id, org_id, project_id, package_id, ref_no, type, item, status, requested_by, decided_by, decided_at,
   decision_reason, created_at)
values
  ('00000000-0000-4000-8000-00000a180aa1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   '00000000-0000-4000-8000-0000000000e1', 'AP-PGTAP-1', 'other', 'Pgtap coping stone', 'rejected',
   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d6', now() - interval '1 day',
   'Too glossy', now() - interval '2 days');

-- Zero on hand with no reorder level: Critical on the Inventory page, so in
-- the bell too now. One on the project, one in the central store.
-- Each carries its own SKU: inventory_sku_uq is `nulls not distinct`, so a
-- second SKU-less item in one project would abort the insert (see 12_).
insert into public.inventory_items (id, org_id, project_id, name, sku, unit, qty_on_hand, reorder_level, unit_cost) values
  ('00000000-0000-4000-8000-00000a1806a1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
   'Pgtap zero item', 'T15-1', 'nos', 0, 0, 10),
  ('00000000-0000-4000-8000-00000a1806b1', '00000000-0000-4000-8000-0000000000a0', null,
   'Pgtap central zero item', 'T15-2', 'nos', 0, 0, 10);

-- The seeded submitted bill (RA-2), certified a moment ago.
update public.bills set status = 'certified', certified_at = now() - interval '1 hour',
                        certified_by = '00000000-0000-4000-8000-0000000000d6'
 where id = '00000000-0000-4000-8000-000000000402';

set local role authenticated;

-- ── site (d5) ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'stock_approved' and entity_id = '00000000-0000-4000-8000-00000a1800a1'
             and for_profile_id = '00000000-0000-4000-8000-0000000000d5' and for_profile_role = 'site'),
  'site: the requester is told their request was approved'
);

select ok(
  not exists (select 1 from public.v_notifications
               where kind = 'stock_approved' and entity_id = '00000000-0000-4000-8000-00000a1800e1'),
  'site: an approval older than 14 days is not news any more'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'stock_ordered' and entity_id = '00000000-0000-4000-8000-00000a1800b1'
             and 'site' = any (for_roles)),
  'site: an ordered request is addressed to site members'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'delivery_due' and entity_id = '00000000-0000-4000-8000-00000a1800b1'),
  'site: the ordered request is waiting on site as a delivery'
);

select is(
  (select created_at from public.v_notifications
    where kind = 'stock_rejected' and entity_id = '00000000-0000-4000-8000-00000a1800d1'),
  -- The fixture event's own timestamp; now() is fixed for the transaction.
  now() - interval '20 hours',
  'site: a rejection is dated by its event, though site cannot read stock_request_events itself'
);

select ok(
  (select title from public.v_notifications
    where kind = 'stock_rejected' and entity_id = '00000000-0000-4000-8000-00000a1800d1') ~ 'Use the leftover stock',
  'site: the rejection carries its reason'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'approval_rejected' and entity_id = '00000000-0000-4000-8000-00000a180aa1'
             and for_profile_id = '00000000-0000-4000-8000-0000000000d5' and title ~ 'Too glossy'),
  'site: the requester of an approval is told it was rejected, with the reason'
);

select is(
  (select count(*)::int from public.v_notifications
    where kind in ('bill_certified', 'bill_rejected', 'bill_draft', 'bill_unpaid', 'approval_revision',
                   'stock_delivered')),
  0,
  'site: no admin-only row at all, even reading the view directly'
);

select isnt_empty(
  $$ select 1 from public.v_stock_request_notify
      where id = '00000000-0000-4000-8000-00000a1800a1' and requester_role = 'site' $$,
  'site: reads its project''s requests through v_stock_request_notify, with the requester''s role'
);

-- ── client (d6) ─────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select is(
  (select count(*)::int from public.v_stock_request_notify),
  0,
  'client: v_stock_request_notify returns nothing — a client never sees stock'
);

select is(
  (select count(*)::int from public.v_notifications
    where kind in ('stock_approved', 'stock_ordered', 'stock_delivered', 'stock_rejected', 'delivery_due')),
  0,
  'client: no stock status-change or delivery row, even reading the view directly'
);

select ok(
  not exists (select 1 from public.v_notifications
               where for_profile_id = '00000000-0000-4000-8000-0000000000d6'),
  'client: is never a named recipient'
);

-- ── admin (d2) ──────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'stock_delivered' and entity_id = '00000000-0000-4000-8000-00000a1800c1'
             and for_roles = array['admin'::public.app_role]),
  'admin: a delivery is addressed to admins'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'approval_rejected' and entity_id = '00000000-0000-4000-8000-00000a180aa1'
             and 'admin' = any (for_roles)),
  'admin: a client''s rejection of an approval reaches admins'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'approval_revision' and entity_id = '00000000-0000-4000-8000-00000a180aa1'),
  'admin: the rejected approval is waiting on admin to raise a revision'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'bill_certified' and entity_id = '00000000-0000-4000-8000-000000000402'),
  'admin: a certified bill is news for admins (APX-62)'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'bill_unpaid' and entity_id = '00000000-0000-4000-8000-000000000402'),
  'admin: the certified bill is waiting on admin to record payment'
);

select ok(
  not exists (select 1 from public.v_notifications
               where kind = 'bill_submitted' and entity_id = '00000000-0000-4000-8000-000000000402'),
  'admin: once certified it is no longer awaiting certification'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'inventory_low' and entity_id = '00000000-0000-4000-8000-00000a1806a1'
             and title ~ 'critical'),
  'admin: zero on hand with no reorder level is Critical, as on the Inventory page'
);

select ok(
  not exists (select 1 from public.v_notifications
               where title ~ '₹' or title ~ '[0-9]{4,}\.[0-9]{2}'),
  'no notification title carries an amount'
);

-- ── archived projects (APX-41) ──────────────────────────────────────────────
reset role;
update public.projects set status = 'archived' where id = '00000000-0000-4000-8000-0000000000c1';
set local role authenticated;

select is(
  (select count(*)::int from public.v_notifications where project_id = '00000000-0000-4000-8000-0000000000c1'),
  0,
  'admin: nothing at all from an archived project'
);

select ok(
  exists (select 1 from public.v_notifications
           where kind = 'inventory_low' and entity_id = '00000000-0000-4000-8000-00000a1806b1'
             and project_id is null),
  'admin: central-store items, which have no project, are kept'
);

select * from finish();
rollback;
