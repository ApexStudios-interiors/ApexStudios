-- Build 05 — task progress and phase-completion RPCs.
--
-- The behavioural assertions (does the phase actually flip, does a client get
-- refused, does a billed phase stay billed) run from a real client SDK
-- session in tests/integration/schedule.test.ts (AGENTS.md database rule 8).
-- This file is the fast structural companion: which functions exist, with
-- what security properties, and that tasks itself is readable by every role
-- (it carries no money, unlike packages/phases/bills).

begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_set_task_progress' and not p.prosecdef $$,
  'rpc_set_task_progress is security definer'
);
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'rpc_mark_phase_complete' and not p.prosecdef $$,
  'rpc_mark_phase_complete is security definer'
);
select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'anon'
        and r.routine_name in ('rpc_set_task_progress', 'rpc_mark_phase_complete') $$,
  'neither schedule RPC is executable by anon'
);

-- ── tasks carries no money, so unlike packages it is a plain members-read ────
select is(
  (select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
    where c.relname = 'tasks' and p.polcmd = 'r'),
  1, 'tasks has exactly one select policy'
);
select ok(
  (select pg_get_expr(p.polqual, p.polrelid) not like '%is_admin%' from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'tasks' and p.polcmd = 'r'),
  'the tasks select policy is not gated on is_admin() — site and client read it directly too'
);
select matches(
  (select pg_get_expr(p.polqual, p.polrelid) from pg_policy p
     join pg_class c on c.oid = p.polrelid
    where c.relname = 'tasks' and p.polcmd = 'r'),
  'is_member_of',
  'the tasks select policy is gated on membership, not admin — every role reads it directly'
);

-- Found live, not in review (D24): this trigger validates a task's
-- denormalised ancestry by reading `phases`, which is admin-only on select —
-- without SECURITY DEFINER, the trigger's own lookup returns nothing under
-- RLS for a site caller, and misreads that as "phase does not exist" for a
-- phase that genuinely exists.
select is_empty(
  $$ select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'trg_tasks_check_ancestry' and not p.prosecdef $$,
  'trg_tasks_check_ancestry is security definer, or a site task creation always fails'
);

select * from finish();
rollback;
