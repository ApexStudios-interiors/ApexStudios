-- 20261124500001 — v_notifications: status changes, bill outcomes, archived
-- projects, the low-stock predicate, and the "Needs my action" inbox
--
-- APX-18, APX-62 (notification part), APX-41 (notification part), APX-72.
-- docs/decisions.md D68 (2026-11-24, Voola). HLD §8.1 / §8.2 / §8.3 / §11.
--
-- Still no notifications table (ADR-014). Every row below exists exactly as
-- long as its source row says it should, and read state stays in
-- notification_reads (D60), keyed (kind, entity_id) and compared against
-- created_at. Each new branch therefore uses the TRANSITION's own timestamp as
-- created_at — approved_at, ordered_at, decided_at, certified_at, the
-- rejection event — so an existing receipt works unchanged, and each
-- transition is its own kind, so "approved" being read never silences the
-- later "ordered".
--
-- ── What changes ────────────────────────────────────────────────────────────
--
-- 1. New branches (bell + inbox). The status-change ones are WINDOWED to the
--    last 14 days: a status change is news, not open work, and without a
--    window a supervisor's bell would list every request ever approved.
--
--      kind               source / created_at        audience
--      stock_approved     approved_at                its requester
--      stock_ordered      ordered_at                 site (members) + requester
--      stock_delivered    delivered_at               admins
--      stock_rejected     the rejection (with reason) its requester
--      approval_approved  decided_at                 admins + its requester
--      approval_rejected  decided_at (with reason)   admins + its requester
--      bill_certified     certified_at               admins
--      bill_rejected      the rejection (with reason) admins
--
-- 2. New inbox-only branches (the app keeps them out of the bell — see
--    features/notifications/service.ts BELL_KINDS). These are STATE, not news,
--    so they are not windowed: they last exactly as long as the work waits.
--
--      bill_draft         draft bill awaiting submit  admins
--      bill_unpaid        certified, not yet paid     admins
--      approval_revision  rejected, not superseded    admins
--      delivery_due       ordered, not yet delivered  site (members)
--
-- 3. Two columns, appended (create or replace view allows only appending):
--      for_profile_id    one named recipient (the requester), or null
--      for_profile_role  that recipient's role, so an admin PREVIEWING a role
--                        (APX-65) can be shown the personal rows that role
--                        would receive, without pretending to be a person.
--    A row is for a session when its role is in for_roles OR it is the named
--    recipient. That match is a display concern applied by the app, exactly as
--    for_roles always was; visibility itself is still each source's own RLS.
--
-- 4. Archived projects are excluded from every branch (APX-41). The
--    exists() runs under the caller's own RLS (this view stays
--    security_invoker), which also drops a soft-deleted project's rows.
--    Central-store inventory (project_id null) is kept.
--
-- 5. Low stock is `qty_on_hand = 0 or qty_on_hand < reorder_level`, the same
--    rule as v_inventory_status / features/inventory/service.ts
--    inventoryStatus — so an item at zero with no reorder level, which the
--    Inventory page calls Critical, now reaches the bell too.
--
-- The four existing branches are otherwise unchanged: same kinds, titles,
-- hrefs, created_at and for_roles.
--
-- ── Money and stock boundaries ──────────────────────────────────────────────
-- Admin-only branches also carry `public.is_admin()` in their own WHERE, so a
-- non-admin reading the view directly (without the app's audience filter)
-- gets none of those rows at all — the bill_events reason included.
-- No title carries an amount. Bill kinds are admin/client only, never site.
-- Stock kinds never name 'client', their named recipient is always a requester
-- (admin or site: sr_insert), and v_stock_request_notify returns nothing at all
-- to a client session.

-- ── v_stock_request_notify ──────────────────────────────────────────────────
-- Why a new view rather than v_stock_request_site: a rejection has no
-- timestamp column on stock_requests, and the event that records it is not
-- readable by Site (sr_events_select's subquery reads public.stock_requests,
-- whose only select policy is admin's — the D35 bug class). Same model as
-- v_stock_request_site (migration 0014): security_invoker = off with the
-- membership guard inside, plus a role guard, and only non-money columns —
-- no rate, no billed_on_bill_id. Read-only; no RPC or policy changes.
create view public.v_stock_request_notify
with (security_invoker = off) as
select
  sr.id,
  sr.project_id,
  sr.ref_no,
  sr.material_name,
  sr.status,
  sr.requested_by,
  (select p.role from public.profiles p where p.id = sr.requested_by) as requester_role,
  sr.needed_by,
  sr.created_at,
  sr.approved_at,
  sr.ordered_at,
  sr.delivered_at,
  case when sr.status = 'rejected' then
    coalesce(
      (select max(e.created_at) from public.stock_request_events e
        where e.request_id = sr.id and e.to_status = 'rejected'),
      sr.updated_at
    )
  end as rejected_at,
  sr.rejected_reason
from public.stock_requests sr
where sr.deleted_at is null
  and public.is_member_of(sr.project_id)
  and public.auth_role() = any (array['admin'::public.app_role, 'site'::public.app_role]);

comment on view public.v_stock_request_notify is
  'D68 (2026-11-24). Stock request status timestamps for v_notifications, admin/site only. Omits rate and billed_on_bill_id like v_stock_request_site; adds rejected_at (from stock_request_events) and the requester''s role.';

-- Not revoked from anon: v_notifications is security_invoker, so an anon read
-- of IT checks anon's privilege on this view too, and a revoke turns anon's
-- empty result into a permission error (caught by
-- tests/integration/notifications.test.ts). anon gets zero rows here anyway:
-- auth_role() is null for it, so the role guard above is false.
grant select on public.v_stock_request_notify to anon, authenticated;

-- ── v_notifications ─────────────────────────────────────────────────────────
create or replace view public.v_notifications
with (security_invoker = on) as
select u.kind, u.entity_id, u.project_id, u.title, u.href, u.created_at, u.for_roles,
       u.for_profile_id, u.for_profile_role
from (
  -- ── Existing branches (behaviour unchanged) ──
  select 'stock_request'::text as kind,
      sr.id as entity_id,
      sr.project_id,
      'Pending stock request: '::text || sr.material_name as title,
      ('/projects/'::text || sr.project_id) || '/stock'::text as href,
      sr.created_at,
      array['admin'::public.app_role, 'site'::public.app_role] as for_roles,
      null::uuid as for_profile_id,
      null::public.app_role as for_profile_role
    from public.v_stock_request_site sr
   where sr.status = 'pending'::public.stock_request_status
  union all
  select 'bill_submitted'::text,
      b.id,
      b.project_id,
      ('Bill '::text || b.bill_no) || ' awaiting certification'::text,
      ('/projects/'::text || b.project_id) || '/billing'::text,
      b.submitted_at,
      array['admin'::public.app_role, 'client'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_bill_client b
   where b.status = 'submitted'::public.bill_status
  union all
  select 'approval_pending'::text,
      a.id,
      a.project_id,
      'Approval needed: '::text || a.item,
      ('/projects/'::text || a.project_id) || '/approvals'::text,
      a.created_at,
      array['client'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.approvals a
   where a.status = 'pending'::public.approval_status and a.deleted_at is null
  union all
  select 'inventory_low'::text,
      i.id,
      i.project_id,
      (i.name || ' is '::text) ||
        case when i.qty_on_hand = 0::numeric then 'critical'::text else 'low'::text end,
      coalesce(('/projects/'::text || i.project_id) || '/inventory'::text, '/inventory'::text),
      i.updated_at,
      array['admin'::public.app_role, 'site'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.inventory_items i
   where i.deleted_at is null
     -- Aligned with the Inventory page (v_inventory_status): zero is critical
     -- even when no reorder level is set.
     and (i.qty_on_hand = 0::numeric or i.qty_on_hand < i.reorder_level)

  -- ── Stock request status changes (APX-18), last 14 days ──
  union all
  select 'stock_approved'::text,
      s.id,
      s.project_id,
      'Stock request approved: '::text || s.material_name,
      ('/projects/'::text || s.project_id) || '/stock'::text,
      s.approved_at,
      '{}'::public.app_role[],
      s.requested_by,
      s.requester_role
    from public.v_stock_request_notify s
   where s.status = 'approved'::public.stock_request_status
     and s.approved_at >= now() - interval '14 days'
  union all
  select 'stock_ordered'::text,
      s.id,
      s.project_id,
      'Ordered: '::text || s.material_name,
      ('/projects/'::text || s.project_id) || '/stock'::text,
      s.ordered_at,
      array['site'::public.app_role],
      s.requested_by,
      s.requester_role
    from public.v_stock_request_notify s
   where s.status = 'ordered'::public.stock_request_status
     and s.ordered_at >= now() - interval '14 days'
  union all
  select 'stock_delivered'::text,
      s.id,
      s.project_id,
      'Delivered: '::text || s.material_name,
      ('/projects/'::text || s.project_id) || '/stock'::text,
      s.delivered_at,
      array['admin'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_stock_request_notify s
   where s.status = 'delivered'::public.stock_request_status
     and s.delivered_at >= now() - interval '14 days'
     and public.is_admin()
  union all
  select 'stock_rejected'::text,
      s.id,
      s.project_id,
      ('Stock request rejected: '::text || s.material_name)
        || coalesce(' — '::text || s.rejected_reason, ''::text),
      ('/projects/'::text || s.project_id) || '/stock'::text,
      s.rejected_at,
      '{}'::public.app_role[],
      s.requested_by,
      s.requester_role
    from public.v_stock_request_notify s
   where s.status = 'rejected'::public.stock_request_status
     and s.rejected_at >= now() - interval '14 days'

  -- ── Approval decisions (APX-18), last 14 days ──
  union all
  select case when a.status = 'approved'::public.approval_status
              then 'approval_approved'::text else 'approval_rejected'::text end,
      a.id,
      a.project_id,
      case when a.status = 'approved'::public.approval_status
           then 'Client approved: '::text || a.item
           else ('Client rejected: '::text || a.item)
                || coalesce(' — '::text || a.decision_reason, ''::text) end,
      ('/projects/'::text || a.project_id) || '/approvals'::text,
      a.decided_at,
      array['admin'::public.app_role],
      a.requested_by,
      (select p.role from public.profiles p where p.id = a.requested_by)
    from public.approvals a
   where a.deleted_at is null
     and a.status = any (array['approved'::public.approval_status, 'rejected'::public.approval_status])
     and a.decided_at >= now() - interval '14 days'

  -- ── Bill outcomes (APX-62), last 14 days, admins only ──
  union all
  select 'bill_certified'::text,
      b.id,
      b.project_id,
      ('Bill '::text || b.bill_no) || ' certified by the client'::text,
      ('/projects/'::text || b.project_id) || '/billing'::text,
      b.certified_at,
      array['admin'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_bill_client b
   where b.status = any (array['certified'::public.bill_status, 'paid'::public.bill_status])
     and b.certified_at >= now() - interval '14 days'
     and public.is_admin()
  union all
  -- A client rejection returns the bill to draft with a mandatory reason, kept
  -- on the bill_events row. Only the latest rejection, and only while the bill
  -- is still a draft: once it has been resubmitted the rejection is handled.
  select 'bill_rejected'::text,
      b.id,
      b.project_id,
      (('Bill '::text || b.bill_no) || ' rejected by the client'::text)
        || coalesce(' — '::text || r.note, ''::text),
      ('/projects/'::text || b.project_id) || '/billing'::text,
      r.created_at,
      array['admin'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_bill_client b
    join lateral (
      select e.note, e.created_at
        from public.bill_events e
       where e.bill_id = b.id
         and e.from_status = 'submitted'::public.bill_status
         and e.to_status = 'draft'::public.bill_status
       order by e.created_at desc
       limit 1
    ) r on true
   where b.status = 'draft'::public.bill_status
     and r.created_at >= now() - interval '14 days'
     and public.is_admin()

  -- ── Inbox-only state (APX-72): not windowed, lasts as long as the work ──
  union all
  select 'bill_draft'::text,
      b.id,
      b.project_id,
      ('Bill '::text || b.bill_no) || ' is a draft — review and submit'::text,
      ('/projects/'::text || b.project_id) || '/billing'::text,
      -- A rejected-back draft has waited since its rejection, not since it was
      -- first created.
      coalesce(
        (select max(e.created_at) from public.bill_events e
          where e.bill_id = b.id and e.to_status = 'draft'::public.bill_status),
        b.created_at
      ),
      array['admin'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_bill_client b
   where b.status = 'draft'::public.bill_status
     and public.is_admin()
  union all
  select 'bill_unpaid'::text,
      b.id,
      b.project_id,
      ('Bill '::text || b.bill_no) || ' certified — record the payment'::text,
      ('/projects/'::text || b.project_id) || '/billing'::text,
      b.certified_at,
      array['admin'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_bill_client b
   where b.status = 'certified'::public.bill_status
     and public.is_admin()
  union all
  select 'approval_revision'::text,
      a.id,
      a.project_id,
      ('Rejected — raise a revision: '::text || a.item)
        || coalesce(' — '::text || a.decision_reason, ''::text),
      ('/projects/'::text || a.project_id) || '/approvals'::text,
      a.decided_at,
      array['admin'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.approvals a
   where a.deleted_at is null
     and a.status = 'rejected'::public.approval_status
     and not exists (
       select 1 from public.approvals s
        where s.supersedes_id = a.id and s.deleted_at is null
     )
     and public.is_admin()
  union all
  select 'delivery_due'::text,
      s.id,
      s.project_id,
      ('Awaiting delivery: '::text || s.material_name)
        || coalesce(' (needed by '::text || to_char(s.needed_by, 'DD Mon YYYY') || ')'::text, ''::text),
      ('/projects/'::text || s.project_id) || '/stock'::text,
      s.ordered_at,
      array['site'::public.app_role],
      null::uuid,
      null::public.app_role
    from public.v_stock_request_notify s
   where s.status = 'ordered'::public.stock_request_status
) u
-- APX-41: nothing from an archived project. Central-store rows have no project.
where u.project_id is null
   or exists (
     select 1 from public.projects p
      where p.id = u.project_id
        and p.status <> 'archived'::public.project_status
   );

comment on view public.v_notifications is
  'Computed live; no notification table. Read state lives in notification_reads (D60). Roles: admin, site, client. D68 (2026-11-24): status-change kinds (14-day window, created_at = the transition), inbox-only state kinds, for_profile_id/for_profile_role for a named recipient, archived projects excluded.';

grant select on public.v_notifications to authenticated;
