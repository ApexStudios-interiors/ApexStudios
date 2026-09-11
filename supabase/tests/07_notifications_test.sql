-- Build 07 — v_notifications. build/07-stock-inventory-notifications.md §2.6.
--
-- Behavioural role-scoping (a real Client session actually sees
-- bill_submitted, a real Site session doesn't) runs from real client SDK
-- sessions in tests/integration/notifications.test.ts (AGENTS.md database
-- rule 8). This file is the fast structural companion: grants, and a static
-- check that the bill_submitted branch keeps reading v_bill_client rather
-- than regressing back to public.bills directly (D33, docs/decisions.md).

begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

select isnt_empty(
  $$ select 1 from pg_views where schemaname = 'public' and viewname = 'v_notifications' $$,
  'v_notifications exists'
);

-- Not asserting anon has no grant here: this Supabase project's default
-- table privileges grant every DML verb to anon and authenticated alike on
-- every table and view (confirmed live against v_bill_client and
-- v_stock_request_site, both already-established role-scoped views) — RLS
-- (`force row level security` on every underlying base table) is the actual
-- and only enforcement layer, per AGENTS.md database rule 2. anon has no
-- `auth.uid()`/`auth_role()` at all, so every branch of this
-- `security_invoker = on` view denies it through the base tables' own
-- policies regardless of the view's own grant row.

select isnt_empty(
  $$ select 1 from information_schema.role_table_grants
      where table_name = 'v_notifications' and grantee = 'authenticated' and privilege_type = 'SELECT' $$,
  'v_notifications is readable by authenticated'
);

-- D33: the bill_submitted branch must read v_bill_client, not public.bills
-- directly — public.bills has no select policy for Client at all, so a
-- direct read silently returns zero rows for exactly the role this
-- notification exists for. pg_get_viewdef is the static proof that the fix
-- (migration 20260913090005) is still in place, without needing a live JWT.
select ok(
  pg_get_viewdef('public.v_notifications'::regclass) ~ 'v_bill_client'
    and pg_get_viewdef('public.v_notifications'::regclass) !~ 'from public\.bills\b',
  'the bill_submitted branch reads v_bill_client, never public.bills directly (D33)'
);

-- D35: the same bug class, one branch over — stock_request must read
-- v_stock_request_site, not public.stock_requests directly. That table's
-- only select policy is admin-only (sr_select_admin, 0007); Site has no
-- policy on it at all, so a direct read silently returned zero rows for
-- exactly the role this notification exists for (01-hld.md §11). Confirmed
-- live against a real Site JWT before this fix (migration 20260914090002).
select ok(
  pg_get_viewdef('public.v_notifications'::regclass) ~ 'v_stock_request_site'
    and pg_get_viewdef('public.v_notifications'::regclass) !~ 'from public\.stock_requests\b',
  'the stock_request branch reads v_stock_request_site, never public.stock_requests directly (D35)'
);

select * from finish();
rollback;
