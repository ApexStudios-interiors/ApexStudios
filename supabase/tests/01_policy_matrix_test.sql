-- The policy matrix, asserted role by role.
--
-- 02-lld.md §6.1 and §6.3. These run in-database with an impersonated JWT, which
-- is the right tool for asserting the SHAPE of the matrix — which policies exist,
-- for which command, for which role.
--
-- They are NOT the authoritative RLS test. AGENTS.md database rule 8 requires the
-- behavioural assertions to run from a real client SDK session, because anything
-- in-database can be made to lie by a mistake in the impersonation itself. That
-- suite is tests/rls/*.test.ts and it is the one that gates the build. This file
-- is the fast structural companion to it.

begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- ── packages and phases are admin-only on select ─────────────────────────────
-- They carry internal_amount. Every other role reaches them through the
-- role-scoped views in migration 0014.
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'packages' and p.polcmd = 'r'),
  1, 'packages has exactly one select policy'
);
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'packages' and p.polcmd = 'r'),
  'is_admin', 'the packages select policy is gated on is_admin()'
);
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'phases' and p.polcmd = 'r'),
  'is_admin', 'the phases select policy is gated on is_admin()'
);
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'bills' and p.polcmd = 'r'),
  'is_admin', 'the bills select policy is gated on is_admin()'
);
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'stock_requests' and p.polcmd = 'r'),
  'is_admin', 'the stock_requests select policy is gated on is_admin()'
);

-- ── RPC-only write paths ─────────────────────────────────────────────────────
-- "via RPC only" means no policy grants the operation to authenticated at all.
-- That is what stops a direct PostgREST call from bypassing the business rules
-- in 02-lld.md §5, even for an authenticated admin.
select is_empty(
  $$ select p.polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'bills' and p.polcmd in ('a', 'w') $$,
  'bills has no insert or update policy — rpc_create_bill and rpc_transition_bill are the only way in'
);
select is_empty(
  $$ select p.polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'stock_movements' and p.polcmd <> 'r' $$,
  'stock_movements has no write policy of any kind'
);
select is_empty(
  $$ select p.polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'audit_log' and p.polcmd <> 'r' $$,
  'audit_log has no write policy of any kind, including for owner'
);
select is_empty(
  $$ select p.polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'approvals' and p.polcmd = 'w' $$,
  'approvals has no update policy — only rpc_decide_approval decides, and only a client may call it'
);
select is_empty(
  $$ select p.polname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relname = 'inventory_items' and p.polcmd = 'w' $$,
  'inventory_items has no update policy — qty_on_hand moves only under a row lock in an RPC'
);

-- ── the double-billing guard ─────────────────────────────────────────────────
select ok(
  (select indisunique from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_bill_lines_source'),
  'idx_bill_lines_source is UNIQUE — it is the double-billing guard, not a lookup index'
);
select isnt(
  (select pg_get_expr(i.indpred, i.indrelid) from pg_index i
     join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_bill_lines_source'),
  null,
  'idx_bill_lines_source is partial, so manual and adjustment lines do not collide on a null source'
);

-- ── role-scoped views omit the columns they must omit ────────────────────────
-- The rule from 02-lld.md §4.3: absent, not null, not zero.
-- v_phase_site (build/04-projects-packages-phases.md, since v_phase_client had
-- no site-facing counterpart) is asserted here alongside the rest, re-running
-- T-11 for this build's changes.
select is_empty(
  $$ select (table_name || '.' || column_name)::text
       from information_schema.columns
      where table_schema = 'public'
        and table_name in ('v_package_client', 'v_phase_client', 'v_bill_client',
                           'v_bill_line_client', 'v_package_site', 'v_phase_site',
                           'v_inventory_site', 'v_stock_request_site')
        and column_name in ('internal_amount', 'internal_cost', 'internal_cost_amount',
                            'margin_amount', 'unit_cost', 'rate', 'committed',
                            'remaining', 'used_pct') $$,
  'no role-scoped view exposes a cost or margin column'
);

-- A site supervisor sees no money at all — not even the client-facing figure.
select is_empty(
  $$ select (table_name || '.' || column_name)::text
       from information_schema.columns
      where table_schema = 'public'
        and table_name in ('v_package_site', 'v_phase_site', 'v_inventory_site',
                           'v_stock_request_site')
        and column_name in ('allocated_amount', 'contract_value', 'amount',
                            'client_value', 'stock_value') $$,
  'no site-facing view exposes any money column'
);

-- v_client_name (D21): the non-admin-safe client lookup exposes only id/name,
-- never the admin-only contact and billing fields on the base clients table.
select is_empty(
  $$ select column_name::text
       from information_schema.columns
      where table_schema = 'public' and table_name = 'v_client_name'
        and column_name not in ('id', 'name') $$,
  'v_client_name exposes only id and name'
);

select * from finish();
rollback;
