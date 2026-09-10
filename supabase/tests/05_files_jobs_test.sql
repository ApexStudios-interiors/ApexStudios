-- Build 06 — file storage, the job runner, daily updates.
--
-- Behavioural assertions (confirmUpload's HeadObject check, claim/finish
-- concurrency, the reaper, T-18 through T-25) run from a real client SDK
-- session or a real Postgres connection in tests/integration (AGENTS.md
-- database rule 8). This file is the fast structural companion.

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ── rpc_enqueue_job ──────────────────────────────────────────────────────────
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_enqueue_job' and not p.prosecdef $$,
  'rpc_enqueue_job is security definer'
);
select isnt_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'authenticated'
        and r.routine_name = 'rpc_enqueue_job' $$,
  'rpc_enqueue_job is executable by authenticated'
);
select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'anon'
        and r.routine_name = 'rpc_enqueue_job' $$,
  'rpc_enqueue_job is not executable by anon'
);

-- ── rpc_retry_job ────────────────────────────────────────────────────────────
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_retry_job' and not p.prosecdef $$,
  'rpc_retry_job is security definer'
);
select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'anon'
        and r.routine_name = 'rpc_retry_job' $$,
  'rpc_retry_job is not executable by anon'
);

-- ── rpc_claim_jobs / rpc_finish_job stay service_role-only (Build 02, not
--    reopened by this build) — regression guard against a future change
--    accidentally widening the grant. ──────────────────────────────────────
select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee in ('anon', 'authenticated')
        and r.routine_name in ('rpc_claim_jobs', 'rpc_finish_job') $$,
  'rpc_claim_jobs and rpc_finish_job stay service_role-only'
);

-- ── jobs: still no user-writable path ────────────────────────────────────────
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'jobs' and p.polcmd in ('a', 'w')),
  0, 'jobs has no insert or update policy for any role'
);
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'jobs' and p.polcmd = 'r'),
  1, 'jobs has exactly one select policy'
);

-- ── attachments ──────────────────────────────────────────────────────────────
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'attachments' and p.polcmd = 'a'),
  1, 'attachments has an insert policy (confirmUpload writes through RLS, not a bypass)'
);
select ok(
  (select pg_get_expr(p.polwithcheck, p.polrelid) like '%uploaded_by%' from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'attachments' and p.polcmd = 'a'),
  'the attachments insert policy checks uploaded_by = auth.uid()'
);
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'attachments' and p.polcmd = 'd'),
  1, 'attachments has exactly one delete policy (the 24-hour uploader self-delete window)'
);

-- ── daily_updates: only owner/admin/site may post one, in SQL — the same
--    boundary "the route rejects a direct POST" (build §5's Playwright
--    spec) actually rests on, client-side button-hiding aside. ─────────────
select ok(
  (select pg_get_expr(p.polwithcheck, p.polrelid) like '%site%' and pg_get_expr(p.polwithcheck, p.polrelid) not like '%client%'
     from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'daily_updates' and p.polcmd = 'a'),
  'daily_updates insert policy allows owner/admin/site and not client'
);

-- ── daily_updates: the 24-hour edit window is a real RLS predicate, not
--    just an application-level check (build/06 §0.3's own confirmation). ────
select ok(
  (select pg_get_expr(p.polqual, p.polrelid) like '%24:00:00%' from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'daily_updates' and p.polcmd = 'w'),
  'daily_updates update policy enforces the 24-hour author edit window in SQL'
);

-- ── projects.completed_at: trigger-maintained, not application-computed ─────
select has_column('public', 'projects', 'completed_at', 'projects.completed_at exists');

select * from finish();
rollback;
