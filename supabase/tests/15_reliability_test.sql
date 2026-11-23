-- Migrations 20261124600001–20261124600006 (APX-06, -21, -23, -26, -43, -45,
-- -52, -66): the catalogue facts their behaviour depends on. The behaviour
-- itself is tested in tests/integration/reliability.test.ts.

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- ── service_role-only RPCs stay service_role-only ────────────────────────────
select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee in ('anon', 'authenticated', 'PUBLIC')
        and r.routine_name in ('rpc_reap_jobs', 'rpc_r2_keys_referenced', 'rpc_finish_job', 'rpc_claim_jobs') $$,
  'rpc_reap_jobs, rpc_r2_keys_referenced, rpc_finish_job and rpc_claim_jobs are not executable by anon or authenticated'
);

-- ── the two shell aggregates are invoker-mode, so RLS still decides ──────────
select is_empty(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.proname in ('rpc_portfolio_money', 'rpc_notification_unread_count') $$,
  'rpc_portfolio_money and rpc_notification_unread_count are SECURITY INVOKER'
);

select is_empty(
  $$ select r.routine_name::text from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee in ('anon', 'PUBLIC')
        and r.routine_name in ('rpc_portfolio_money', 'rpc_notification_unread_count') $$,
  'the shell aggregates are not executable by anon'
);

-- ── evidence foreign keys from projects are RESTRICT (APX-66) ────────────────
select is(
  (select count(*)::int from pg_constraint
    where contype = 'f'
      and confrelid = 'public.projects'::regclass
      and conrelid in ('public.stock_requests'::regclass, 'public.approvals'::regclass,
                       'public.daily_updates'::regclass, 'public.attachments'::regclass)
      and confdeltype = 'r'),
  4, 'stock_requests, approvals, daily_updates and attachments RESTRICT a project hard delete'
);

-- ── triggers the rollups and allocation now depend on ────────────────────────
select has_trigger('public', 'packages', 'trg_packages_after_change',
  'packages re-weight project progress on insert/allocation/delete (APX-21)');
select has_trigger('public', 'packages', 'trg_packages_assign_seq',
  'packages allocate seq_no in SQL (APX-45)');
select has_trigger('public', 'phases', 'trg_phases_assign_seq',
  'phases allocate seq_no in SQL (APX-45)');

-- ── is_complete: a manual completion does not outvote live tasks (APX-43) ────
select is_empty(
  $$ select vb.phase_id from public.v_phase_billing vb
      where vb.task_count > 0 and vb.is_complete and vb.tasks_done < vb.task_count $$,
  'no phase with an unfinished live task reads as complete'
);

select * from finish();
rollback;
