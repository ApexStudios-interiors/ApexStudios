-- Structural assertions over the catalogue, not over a list anyone maintains.
--
-- docs/build/02-database.md §5.2. These are cheap, and they catch the failure
-- mode where a migration in Build 05–09 forgets a rule that everybody agreed to
-- in Build 02. Because they read pg_catalog rather than a hardcoded table list,
-- they keep working as tables are added.

begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- ── 1. Every table in public has RLS enabled AND forced ──────────────────────
-- Supabase exposes every public table over PostgREST with the anon key whether
-- the application uses it or not. A table without RLS is a public data breach.
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not c.relrowsecurity $$,
  'every table in public has row level security enabled'
);

select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and not c.relforcerowsecurity $$,
  'every table in public forces row level security, so it applies to the owner too'
);

-- ── 2. Every table has at least one policy ───────────────────────────────────
-- RLS enabled with no policy denies everything, which is safe but is almost
-- always an oversight rather than a decision. `rate_limits` (build 07,
-- migration 20260914090001) is the one deliberate exception: no session has a
-- legitimate reason to read or write its own throttle counter directly —
-- `rpc_check_rate_limit` (security definer) is the only intended path in, and
-- reading it directly would just be a second way to reset it. Named
-- explicitly here rather than silently excluded, so the next table that shows
-- up in this list is still caught.
select is_empty(
  $$ select c.relname::text
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and c.relname not in ('rate_limits')
        and not exists (select 1 from pg_policy p where p.polrelid = c.oid) $$,
  'every table in public has at least one policy, except the documented zero-policy exceptions'
);

-- ── 3. Every security definer function pins search_path ──────────────────────
-- Without it, a caller creates a schema earlier in the search path, shadows a
-- table name, and the function runs their table with the definer's privileges.
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (
          select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
           where cfg like 'search_path=%'
        ) $$,
  'every security definer function in public sets search_path to empty'
);

-- ── 4. No floating point anywhere in public ──────────────────────────────────
-- AGENTS.md database rule 3. Applies to quantities as well as money: a
-- float quantity multiplied by a numeric rate still produces a wrong invoice.
select is_empty(
  $$ select (c.relname || '.' || a.attname)::text
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and a.attnum > 0 and not a.attisdropped
        and format_type(a.atttypid, null) in
            ('real', 'double precision', 'money') $$,
  'no column in public uses a floating-point or money type'
);

-- ── 5. Append-only tables have no update or delete policy, for any role ──────
-- ADR-007. Corrections are compensating rows. If someone later adds a
-- "fix a typo" path, this is the test that stops it.
select is_empty(
  $$ select (c.relname || ' / ' || p.polname)::text
       from pg_policy p
       join pg_class c on c.oid = p.polrelid
      where c.relname in ('stock_movements', 'audit_log', 'bill_events')
        and p.polcmd in ('w', 'd', '*') $$,
  'stock_movements, audit_log and bill_events have no update or delete policy for any role'
);

select * from finish();
rollback;
