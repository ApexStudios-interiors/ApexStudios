-- APX-11 / APX-41 / APX-10: rpc_set_project_status, the read-only guards on
-- archived and completed projects, and the billed-phase allocation lock
-- (migrations 20261124300000 and 20261124300001).
--
-- Seeded (supabase/seed.sql): admin d2, site d5, org a0; BHEL-NCH c1 (active,
-- package e1, phases f1/f2, tasks), BHEL-ARCH c2 (planning).

begin;
create extension if not exists pgtap with schema extensions;
select plan(30);

-- ── shape ────────────────────────────────────────────────────────────────────
select has_function('public', 'rpc_set_project_status', array['uuid', 'project_status', 'text'],
  'rpc_set_project_status(uuid, project_status, text) exists');

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_set_project_status'),
  'rpc_set_project_status is security definer'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee = 'anon'
        and r.routine_name = 'rpc_set_project_status' $$,
  'rpc_set_project_status is not executable by anon'
);

select is_empty(
  $$ select 1 from information_schema.role_routine_grants r
      where r.routine_schema = 'public' and r.grantee in ('anon', 'authenticated')
        and r.routine_name = 'fn_project_write_refusal' $$,
  'fn_project_write_refusal (reads any project past RLS) is not directly executable'
);

-- The matrix, pair by pair. features/projects/service.ts
-- PROJECT_STATUS_TRANSITIONS must list exactly these.
select is(
  (select array_agg(f::text || '>' || t::text order by f::text, t::text)
     from unnest(enum_range(null::public.project_status)) f
     cross join unnest(enum_range(null::public.project_status)) t
    where public.fn_project_status_transition_allowed(f, t)),
  array['active>completed', 'active>on_hold', 'archived>completed', 'completed>active',
        'completed>archived', 'on_hold>active', 'on_hold>completed', 'planning>active'],
  'the legal project status transitions are exactly the documented eight'
);

-- ── as admin d2 ──────────────────────────────────────────────────────────────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_ok(
  $$ update public.projects set status = 'active' where id = '00000000-0000-4000-8000-0000000000c2' $$,
  '42501',
  'ILLEGAL_TRANSITION: change a project''s status with rpc_set_project_status',
  'a signed-in admin cannot change status by updating the row directly'
);

select throws_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c2', 'completed') $$,
  '23514',
  null,
  'planning cannot jump straight to completed'
);

select lives_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c2', 'active') $$,
  'planning → active is allowed'
);
select is(
  (select status::text from public.projects where id = '00000000-0000-4000-8000-0000000000c2'),
  'active', 'the project is now active'
);

select lives_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c2', 'completed') $$,
  'active → completed is allowed'
);
select isnt(
  (select completed_at from public.projects where id = '00000000-0000-4000-8000-0000000000c2'),
  null, 'completing a project stamps completed_at'
);

select throws_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c2', 'active') $$,
  '23514',
  null,
  'reopening a completed project without a reason is refused'
);

select lives_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c2', 'archived') $$,
  'completed → archived is allowed'
);
select isnt(
  (select completed_at from public.projects where id = '00000000-0000-4000-8000-0000000000c2'),
  null, 'archiving keeps completed_at'
);

select cmp_ok(
  (select count(*)::int from public.audit_log
    where entity_type = 'project' and action = 'transition'
      and entity_id = '00000000-0000-4000-8000-0000000000c2'),
  '>=', 3,
  'every transition wrote an audit row'
);

select lives_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c2', 'completed',
       'Client asked for one more snag visit') $$,
  'archived → completed with a reason is allowed (reopen)'
);

-- ── as site d5 ───────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);

select throws_ok(
  $$ select public.rpc_set_project_status('00000000-0000-4000-8000-0000000000c1', 'on_hold') $$,
  '42501',
  null,
  'a site supervisor cannot change a project''s status'
);

reset role;

-- The bill-attachment check below uses the seeded paid bill RA-BHEL-NCH-1
-- (…0401) on c1. Since 20261124100004 (APX-05/APX-37) an uploaded attachment's
-- key must sit under its own record's prefix, so the key is
-- org/<org>/project/<project>/bill/<bill>/….

-- ── archived: read-only (as the migration owner; the trigger fires anyway) ──
update public.projects set status = 'archived' where id = '00000000-0000-4000-8000-0000000000c1';

select throws_like(
  $$ insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
             '00000000-0000-4000-8000-0000000000e1', date '2026-11-24', 'pgTAP', '00000000-0000-4000-8000-0000000000d5') $$,
  'PROJECT_ARCHIVED:%',
  'no daily update on an archived project'
);

select throws_like(
  $$ update public.tasks set note = 'pgTAP' where project_id = '00000000-0000-4000-8000-0000000000c1' $$,
  'PROJECT_ARCHIVED:%',
  'no task edit on an archived project'
);

select lives_ok(
  $$ update public.phases set billing_status = 'paid' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  'billing still moves a phase on an archived project (billing_status only)'
);

select throws_like(
  $$ update public.phases set name = name || ' (x)' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  'PROJECT_ARCHIVED:%',
  'no phase edit on an archived project'
);

select lives_ok(
  $$ update public.packages set progress_pct = 1 where id = '00000000-0000-4000-8000-0000000000e1' $$,
  'the progress rollup cache still updates on an archived project'
);

select lives_ok(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'bill',
             '00000000-0000-4000-8000-000000000401',
             'org/00000000-0000-4000-8000-0000000000a0/project/00000000-0000-4000-8000-0000000000c1/bill/00000000-0000-4000-8000-000000000401/archived-bill.pdf',
             'bill.pdf', 'application/pdf', 10,
             '00000000-0000-4000-8000-0000000000d2') $$,
  'a bill attachment (PDF, uploaded copy) still attaches on an archived project'
);

select throws_like(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'project',
             '00000000-0000-4000-8000-0000000000c1', 'pgtap/archived-photo.jpg', 'photo.jpg', 'image/jpeg', 10,
             '00000000-0000-4000-8000-0000000000d2') $$,
  'PROJECT_ARCHIVED:%',
  'no other attachment on an archived project'
);

-- ── completed: no new site work, everything else still works ─────────────────
update public.projects set status = 'completed' where id = '00000000-0000-4000-8000-0000000000c1';

select throws_like(
  $$ insert into public.daily_updates (org_id, project_id, package_id, update_date, body, author_id)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
             '00000000-0000-4000-8000-0000000000e1', date '2026-11-24', 'pgTAP', '00000000-0000-4000-8000-0000000000d5') $$,
  'PROJECT_COMPLETED:%',
  'no new daily update on a completed project'
);

select throws_like(
  $$ insert into public.stock_requests (org_id, project_id, package_id) values
     ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1') $$,
  'PROJECT_COMPLETED:%',
  'no new stock request on a completed project'
);

select lives_ok(
  $$ update public.tasks set note = 'pgTAP' where project_id = '00000000-0000-4000-8000-0000000000c1' $$,
  'a task can still be corrected on a completed project'
);

-- ── a billed phase keeps its allocated amount (f1 was moved to paid above) ──
update public.projects set status = 'active' where id = '00000000-0000-4000-8000-0000000000c1';

select throws_like(
  $$ update public.phases set allocated_amount = allocated_amount + 1 where id = '00000000-0000-4000-8000-0000000000f1' $$,
  'PHASE_BILLED:%',
  'a billed or paid phase''s allocated amount cannot change'
);

select lives_ok(
  $$ update public.phases set name = name || ' (renamed)' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  'a billed phase can still be renamed'
);

-- ── the archive job (service_role) is not blocked by the status guard ───────
set local role service_role;
select lives_ok(
  $$ update public.projects set status = 'archived' where id = '00000000-0000-4000-8000-0000000000c1' $$,
  'service_role (the project.archive job) can still set a status directly'
);
reset role;

select * from finish();
rollback;
