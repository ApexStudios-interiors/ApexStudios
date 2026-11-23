-- Security hardening, audit 2026-11-24 (migrations 20261124100001–…10).
--
-- Like 13_user_role_and_deactivation_test.sql, this simulates each caller's
-- JWT with set_config + `set local role`, because most of these rules are
-- read from auth.uid() / auth_role() inside functions, triggers and definer
-- views — not only RLS policies. The behavioural RLS suite proper remains the
-- client-SDK one (tests/integration, AGENTS.md database rule 8); this file
-- pins each rule down where it lives.
--
-- Seeded (supabase/seed.sql): org a0; admins d1–d4, site d5 (member of c1),
-- client d6 (member of c1 and c2). Bills on c1: 401 paid, 402 and 403
-- submitted, 404 draft, 405 certified.

begin;
create extension if not exists pgtap with schema extensions;
select plan(82);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-01 / APX-56 — who may execute the helpers
-- ═════════════════════════════════════════════════════════════════════════════
select ok(
  not has_function_privilege('anon', 'public.fn_cost_to_client_factor(uuid, uuid)', 'execute'),
  'APX-01: anon cannot execute fn_cost_to_client_factor'
);
select ok(
  not has_function_privilege('authenticated', 'public.fn_audit(text, uuid, text, jsonb, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.fn_audit(text, uuid, text, jsonb, jsonb)', 'execute'),
  'APX-56: nobody can write an audit row of their choosing through fn_audit'
);
select ok(
  not has_function_privilege('authenticated', 'public.fn_recompute_progress(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.fn_recompute_progress(uuid, uuid)', 'execute'),
  'APX-56: nobody can trigger fn_recompute_progress directly'
);

-- The allow-lists. A new SECURITY DEFINER helper (anything not an rpc_*)
-- reachable by a signed-in user, or ANY definer function reachable by anon,
-- must be added here on purpose — that is the point of the test.
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prorettype <> 'trigger'::regtype
        and p.proname not like 'rpc\_%'
        and has_function_privilege('authenticated', p.oid, 'execute')
        and p.proname not in ('auth_role', 'auth_org', 'is_admin', 'is_member_of',
                              'fn_cost_to_client_factor', 'fn_shares_project') $$,
  'every non-RPC SECURITY DEFINER function executable by authenticated is on the allow-list'
);
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('anon', p.oid, 'execute')
        and p.proname not in ('auth_role', 'auth_org', 'is_admin', 'is_member_of',
                              'rpc_login_allowed', 'rpc_login_record_failure') $$,
  'every SECURITY DEFINER function executable by anon is on the allow-list'
);

set local role authenticated;

-- fn_cost_to_client_factor answers only an admin
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is(
  public.fn_cost_to_client_factor('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1'),
  null,
  'APX-01: a client calling fn_cost_to_client_factor gets NULL, not the cost ratio'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select isnt(
  public.fn_cost_to_client_factor('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1'),
  null,
  'APX-01: an admin still gets the factor (Billable Now)'
);

-- rpc_check_rate_limit: the server decides the window
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is(
  (select count(*)::int from generate_series(1, 20) g where public.rpc_check_rate_limit('search', 1000000, 1)),
  20,
  'APX-56: twenty searches in a window are allowed'
);
select is(
  public.rpc_check_rate_limit('search', 1000000, 1),
  false,
  'APX-56: the 21st is refused although the caller asked for a million per second — the limit is the server''s'
);
select is(
  public.rpc_check_rate_limit('search'),
  false,
  'APX-56: the one-argument form shares the same counter'
);
select throws_like(
  $$ select public.rpc_check_rate_limit('made-up-action') $$,
  'FORBIDDEN%',
  'APX-56: an action with no defined limit is refused rather than given an unlimited one'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-58 — an admin is a member of their OWN organisation's projects only
-- ═════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000ff')
)::text, true);
select ok(
  not public.is_member_of('00000000-0000-4000-8000-0000000000c1'),
  'APX-58: an admin of another organisation is not a member of this one''s project'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-09 — the role-scoped views check the role
-- ═════════════════════════════════════════════════════════════════════════════
-- Site
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is((select count(*)::int from public.v_bill_client), 0, 'APX-09: site reads no bill through v_bill_client');
select is((select count(*)::int from public.v_bill_line_client), 0, 'APX-09: site reads no bill line through v_bill_line_client');
select is((select count(*)::int from public.v_package_client), 0, 'APX-09: site reads no contract value through v_package_client');
select is((select count(*)::int from public.v_phase_client), 0, 'APX-09: site reads no contract value through v_phase_client');
select is((select count(*)::int from public.v_project_finance), 0, 'APX-09: site reads nothing from v_project_finance');
select ok((select count(*) from public.v_stock_request_site) > 0, 'APX-09: site still reads its stock requests');
select ok((select count(*) from public.v_inventory_site) > 0, 'APX-09: site still reads its inventory');
select ok((select count(*) from public.v_package_site) > 0, 'APX-09: site still reads the money-free package list');
select throws_ok(
  $$ select contract_value from public.projects $$,
  '42501',
  null,
  'APX-09: site cannot select projects.contract_value'
);
select throws_ok(
  $$ select mobilisation_advance, mobilisation_recovered from public.projects $$,
  '42501',
  null,
  'APX-09: site cannot select the mobilisation figures'
);
select lives_ok(
  $$ select id, code, name, status, progress_pct, rate_visibility from public.projects $$,
  'APX-09: every other projects column still reads normally'
);

-- Client
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is(
  (select count(*)::int from public.v_bill_client where status = 'draft'),
  0,
  'APX-09: a client never sees a draft bill'
);
select is(
  (select count(*)::int from public.v_bill_line_client where bill_id = '00000000-0000-4000-8000-000000000404'),
  0,
  'APX-09: …nor its lines'
);
select ok((select count(*) from public.v_bill_client) > 0, 'APX-09: a client still sees their sent bills');
select is((select count(*)::int from public.v_stock_request_site), 0, 'APX-09: a client reads no stock request');
select is((select count(*)::int from public.v_inventory_site), 0, 'APX-09: a client reads no inventory');
select is(
  (select count(*)::int from public.v_project_finance where id = '00000000-0000-4000-8000-0000000000c1'),
  1,
  'APX-09: a client reads their own project''s contract value through v_project_finance'
);
select ok((select count(*) from public.v_package_client) > 0, 'APX-09: a client still reads v_package_client');
select ok(
  (select count(*) from public.v_package_site) > 0,
  'APX-09: a client still reads package NAMES through v_package_site (Schedule, Approvals, Updates)'
);
select ok(
  exists (select 1 from public.v_notifications where kind = 'bill_submitted'),
  'APX-09: the client''s bell still shows bills awaiting certification'
);

-- Admin
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select ok(
  (select count(*) from public.v_bill_client where status = 'draft') > 0,
  'APX-09: an admin (and so an admin previewing as client) still sees drafts'
);
select is(
  (select count(*)::int from public.v_project_finance where id = '00000000-0000-4000-8000-0000000000c1'),
  1,
  'APX-09: an admin reads contract value and mobilisation through v_project_finance'
);
select ok(
  (select count(*) from public.v_stock_request_site) > 0 and (select count(*) from public.v_phase_client) > 0,
  'APX-09: an admin passes every role predicate'
);

reset role;
select is(
  (select array_agg(c.column_name::text order by c.column_name)
     from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'projects'
      and not has_column_privilege('authenticated', 'public.projects', c.column_name, 'select')),
  array['contract_value', 'mobilisation_advance', 'mobilisation_recovered'],
  'APX-09: authenticated can select every projects column except exactly these three (a new column must be granted)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-02 — rpc_transition_bill hands a client no internal figures
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select ok(
  (select internal_cost_amount is null and margin_amount is null and status = 'certified'
     from public.rpc_transition_bill('00000000-0000-4000-8000-000000000402', 'certified')),
  'APX-02: a client certifying a bill gets no internal_cost_amount or margin_amount back'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-35 — rpc_enqueue_job checks what is queued
-- ═════════════════════════════════════════════════════════════════════════════
select throws_like(
  $$ select public.rpc_enqueue_job('bill.pdf', '{"billId":"00000000-0000-4000-8000-000000000403"}'::jsonb) $$,
  'FORBIDDEN%',
  'APX-35: a client cannot queue an invoice render'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select throws_like(
  $$ select public.rpc_enqueue_job('bill.pdf', '{"billId":"00000000-0000-4000-8000-000000000404"}'::jsonb) $$,
  'ILLEGAL_TRANSITION%',
  'APX-35: a draft bill is never queued for rendering'
);
select isnt(
  public.rpc_enqueue_job('bill.pdf', '{"billId":"00000000-0000-4000-8000-000000000403"}'::jsonb, 'caller-chosen'),
  null,
  'APX-35: an admin queues a submitted bill'
);
select ok(
  (select internal_cost_amount is not null
     from public.rpc_transition_bill('00000000-0000-4000-8000-000000000404', 'submitted')),
  'APX-02: an admin still gets the full row back'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-04 — no forged approval
-- ═════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select throws_ok(
  $$ insert into public.approvals (org_id, project_id, package_id, ref_no, type, item, status,
                                   requested_by, created_by, decided_by, decided_at)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
             '00000000-0000-4000-8000-0000000000e1', 'AP-FORGED-001', 'material_sample', 'Forged',
             'approved', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d5',
             '00000000-0000-4000-8000-0000000000d6', now()) $$,
  '42501',
  null,
  'APX-04: site cannot insert an approval directly, let alone an approved one'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-05 / APX-37 — what an attachment row may claim
-- ═════════════════════════════════════════════════════════════════════════════
select lives_ok(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'daily_update',
             '00000000-0000-4000-8000-00000000aa01',
             'org/00000000-0000-4000-8000-0000000000a0/project/00000000-0000-4000-8000-0000000000c1/daily_update/00000000-0000-4000-8000-00000000aa01/u-photo.jpg',
             'photo.jpg', 'image/jpeg', 100, '00000000-0000-4000-8000-0000000000d5') $$,
  'APX-37: a photo under its own record''s key is accepted'
);
select throws_like(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'daily_update',
             '00000000-0000-4000-8000-00000000aa02',
             'org/00000000-0000-4000-8000-0000000000a0/project/00000000-0000-4000-8000-0000000000c2/approval/x/old-photo.jpg',
             'photo.jpg', 'image/jpeg', 100, '00000000-0000-4000-8000-0000000000d5') $$,
  'FORBIDDEN: that key does not belong to this record',
  'APX-37: a row pointing at someone else''s object key is refused'
);
select throws_like(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', null, 'stock_request',
             '00000000-0000-4000-8000-000000000214', 'org/anything.jpg',
             'photo.jpg', 'image/jpeg', 100, '00000000-0000-4000-8000-0000000000d5') $$,
  'FORBIDDEN: an uploaded file must belong to a project',
  'APX-37: a row with no project (and so no membership test) is refused'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select throws_like(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'bill',
             '00000000-0000-4000-8000-000000000403',
             'org/00000000-0000-4000-8000-0000000000a0/project/00000000-0000-4000-8000-0000000000c1/bill/00000000-0000-4000-8000-000000000403/u-RA-BHEL-NCH-3.pdf',
             'RA-BHEL-NCH-3.pdf', 'application/pdf', 100, '00000000-0000-4000-8000-0000000000d6') $$,
  'FORBIDDEN: only admin or site may attach a file to a bill',
  'APX-05: a client cannot upload a file to a bill, invoice-named or not'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select throws_ok(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by, kind)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'bill',
             '00000000-0000-4000-8000-000000000403',
             'org/00000000-0000-4000-8000-0000000000a0/project/00000000-0000-4000-8000-0000000000c1/bill/00000000-0000-4000-8000-000000000403/u-RA-BHEL-NCH-3.pdf',
             'RA-BHEL-NCH-3.pdf', 'application/pdf', 100, '00000000-0000-4000-8000-0000000000d2', 'generated_invoice') $$,
  '42501',
  null,
  'APX-05: even an admin cannot record a row as the generated invoice — only the job can'
);
select throws_like(
  $$ insert into public.attachments (org_id, project_id, entity_type, entity_id, r2_key, file_name, mime_type, size_bytes, uploaded_by)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c2', 'stock_request',
             '00000000-0000-4000-8000-000000000214',
             'org/00000000-0000-4000-8000-0000000000a0/project/00000000-0000-4000-8000-0000000000c2/stock_request/00000000-0000-4000-8000-000000000214/u-x.pdf',
             'x.pdf', 'application/pdf', 100, '00000000-0000-4000-8000-0000000000d2') $$,
  'NOT_FOUND%',
  'APX-05: a file filed under a project its record does not belong to is refused'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-34 — counters, ledger columns and task progress
-- ═════════════════════════════════════════════════════════════════════════════
select throws_like(
  $$ update public.projects set next_bill_seq = 1 where id = '00000000-0000-4000-8000-0000000000c1' $$,
  'FORBIDDEN%',
  'APX-34: an admin cannot rewind next_bill_seq directly'
);
select throws_like(
  $$ update public.projects set mobilisation_recovered = 0 where id = '00000000-0000-4000-8000-0000000000c1' $$,
  'FORBIDDEN%',
  'APX-34: an admin cannot rewrite mobilisation_recovered directly'
);
select throws_like(
  $$ update public.projects set code = 'BHEL-RENAMED' where id = '00000000-0000-4000-8000-0000000000c1' $$,
  'FORBIDDEN%',
  'APX-34: a project''s code cannot change once a bill carries it'
);
select lives_ok(
  $$ update public.projects set name = name || ' ', contract_value = 58800000
      where id = '00000000-0000-4000-8000-0000000000c1' $$,
  'APX-34: an admin still edits the project''s own fields, contract value included'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select throws_like(
  $$ update public.tasks set progress_pct = 50 where id = '00000000-0000-4000-8000-000000000103' $$,
  'FORBIDDEN%',
  'APX-34: site cannot set progress directly (skipping the audit and the billing flip)'
);
select throws_like(
  $$ update public.tasks set deleted_at = now() where id = '00000000-0000-4000-8000-000000000103' $$,
  'FORBIDDEN%',
  'APX-34: site cannot soft-delete a task directly'
);
select lives_ok(
  $$ update public.tasks set note = 'checked on site', duration_weeks = 4
      where id = '00000000-0000-4000-8000-000000000103' $$,
  'APX-34: site still edits a task''s note, dates and duration'
);
select throws_like(
  $$ insert into public.tasks (org_id, project_id, package_id, phase_id, name, start_date, duration_weeks, progress_pct)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
             '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f4',
             'Born finished', date '2026-09-01', 1, 100) $$,
  'FORBIDDEN%',
  'APX-34: a task cannot be created already at 100%'
);
select lives_ok(
  $$ select public.rpc_set_task_progress('00000000-0000-4000-8000-000000000103', 50::smallint) $$,
  'APX-34: rpc_set_task_progress still sets progress (and audits it)'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-36 — profiles
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'stranger@example.invalid');
insert into public.profiles (id, org_id, full_name, email, role)
values ('00000000-0000-4000-8000-0000000000e9', '00000000-0000-4000-8000-0000000000a0',
        'Another Company', 'stranger@example.invalid', 'client');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d6',
  'app_metadata', json_build_object('app_role', 'client', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-0000000000e9'),
  0,
  'APX-36: a client cannot see another company''s client login'
);
select is(
  (select count(*)::int from public.profiles
    where id in ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000d2',
                 '00000000-0000-4000-8000-0000000000d5')),
  3,
  'APX-36: …but still sees themselves, the admins, and the supervisor on their project'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d5',
  'app_metadata', json_build_object('app_role', 'site', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-0000000000e9'),
  0,
  'APX-36: site cannot see a client who shares none of their projects'
);
select throws_like(
  $$ update public.profiles set email = 'someone-else@example.invalid' where id = '00000000-0000-4000-8000-0000000000d5' $$,
  'FORBIDDEN%',
  'APX-36: a user cannot change their own email (the sign-in identity)'
);
select throws_like(
  $$ update public.profiles set deleted_at = now() where id = '00000000-0000-4000-8000-0000000000d5' $$,
  'FORBIDDEN%',
  'APX-36: a user cannot soft-delete themselves'
);
select lives_ok(
  $$ update public.profiles set full_name = 'Ravi K', phone = '+910000000001' where id = '00000000-0000-4000-8000-0000000000d5' $$,
  'APX-36: a user may still change their own name and phone'
);

select set_config('request.jwt.claims', json_build_object(
  'sub', '00000000-0000-4000-8000-0000000000d2',
  'app_metadata', json_build_object('app_role', 'admin', 'org_id', '00000000-0000-4000-8000-0000000000a0')
)::text, true);
select is(
  (select count(*)::int from public.profiles where id = '00000000-0000-4000-8000-0000000000e9'),
  1,
  'APX-36: an admin still sees the whole organisation'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-38 — login throttle
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select ok(public.rpc_login_allowed('ravi'), 'APX-38: a username with no failures may sign in');
select public.rpc_login_record_failure('ravi') from generate_series(1, 9);
select ok(public.rpc_login_allowed('  RAVI '), 'APX-38: nine failures are still allowed (and the username is normalised)');
select public.rpc_login_record_failure('Ravi');
select is(public.rpc_login_allowed('ravi'), false, 'APX-38: the tenth failure locks that username');
select ok(public.rpc_login_allowed('suresh'), 'APX-38: …and only that username');
select ok(public.rpc_login_allowed('nobody-by-this-name'), 'APX-38: an unknown username is answered like any other');
select is((select count(*)::int from public.login_throttle), 0, 'APX-38: login_throttle is unreadable through the API');
reset role;
select is(
  (select count(*)::int from public.login_throttle where username_hash in ('ravi', 'Ravi')),
  0,
  'APX-38: no username is stored in plain text'
);
select is_empty(
  $$ select 1 from pg_policies where schemaname = 'public' and tablename = 'login_throttle' $$,
  'APX-38: login_throttle has no policy for any role'
);

-- ═════════════════════════════════════════════════════════════════════════════
-- APX-34 — the ledgers are append-only for every role, the table owner too
-- ═════════════════════════════════════════════════════════════════════════════
-- Running as the migration role here — the one RLS never stopped.
select throws_like(
  $$ update public.stock_movements set reason = 'edited' where id = '00000000-0000-4000-8000-000000000901' $$,
  'FORBIDDEN%',
  'APX-34: stock_movements refuses an update, even from the owner'
);
select throws_like(
  $$ delete from public.stock_movements where id = '00000000-0000-4000-8000-000000000901' $$,
  'FORBIDDEN%',
  'APX-34: stock_movements refuses a delete'
);
select throws_like($$ delete from public.audit_log $$, 'FORBIDDEN%', 'APX-34: audit_log refuses a delete');
select throws_like(
  $$ update public.bill_events set note = 'rewritten' $$,
  'FORBIDDEN%',
  'APX-34: bill_events refuses an update'
);
insert into public.stock_request_events (request_id, from_status, to_status, actor_id)
values ('00000000-0000-4000-8000-000000000214', null, 'pending', '00000000-0000-4000-8000-0000000000d5');
select throws_like(
  $$ delete from public.stock_request_events where request_id = '00000000-0000-4000-8000-000000000214' $$,
  'FORBIDDEN%',
  'APX-34: stock_request_events refuses a delete'
);
select throws_like($$ truncate public.audit_log $$, 'FORBIDDEN%', 'APX-34: audit_log refuses a truncate');
select throws_ok(
  $$ insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty)
     values ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000601',
             '00000000-0000-4000-8000-0000000000c1', 'adjust', 1) $$,
  '23514',
  null,
  'APX-34: a movement is in or out — a sign-less ''adjust'' row is refused'
);

-- APX-35: the job the admin queued above is keyed by the bill's revision.
select is(
  (select count(*)::int from public.jobs
    where name = 'bill.pdf' and idempotency_key = '00000000-0000-4000-8000-000000000403:submitted:r1'
      and payload = '{"billId": "00000000-0000-4000-8000-000000000403"}'::jsonb),
  1,
  'APX-35: the queued job carries the server''s payload and revision key, not the caller''s'
);
select is(
  (select count(*)::int from public.jobs where idempotency_key = 'caller-chosen'),
  0,
  'APX-35: the caller''s own idempotency key is ignored'
);

-- The maintenance switch (test cleanup only).
select set_config('apex.ledger_maintenance', 'on', true);
select lives_ok(
  $$ delete from public.stock_request_events where request_id = '00000000-0000-4000-8000-000000000214' $$,
  'APX-34: a direct session that turns apex.ledger_maintenance on may clean up'
);

select * from finish();
rollback;
