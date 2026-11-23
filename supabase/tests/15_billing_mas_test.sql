-- Material-at-site rules and bill dating (migrations 20261124200001-3, D68).
--
-- Structural checks plus the view-level rules, which need no session: the
-- behaviour through real client sessions (every APX-07 ordering, the
-- preview-equals-bill check, concurrency) is tests/integration/billing-mas.test.ts.
-- Runs as the privileged test connection, inside a transaction rolled back at
-- the end, against the seeded project.

begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ── Shape ────────────────────────────────────────────────────────────────────
select has_column('public', 'v_billable_now', 'phase_id', 'v_billable_now carries phase_id');
select has_column('public', 'v_billable_now', 'mas_recovery', 'v_billable_now carries mas_recovery (APX-30: one definition)');
select has_column('public', 'v_billable_now', 'blocked_by_bill_no', 'v_billable_now carries blocked_by_bill_no (R3)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_create_bill'),
  1,
  'rpc_create_bill has exactly one overload — the old five-argument version is dropped'
);
select is(
  (select pronargs::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_create_bill'),
  7,
  'rpc_create_bill takes the billing period (seven arguments)'
);
select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rpc_create_bill'),
  'rpc_create_bill is still security definer'
);
select is_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_create_bill' and grantee = 'anon' $$,
  'rpc_create_bill is not executable by anon'
);
select isnt_empty(
  $$ select 1 from information_schema.role_routine_grants
      where routine_name = 'rpc_create_bill' and grantee = 'authenticated' $$,
  'rpc_create_bill is executable by authenticated'
);
select has_trigger('public', 'bills', 'trg_bills_date_at_submit', 'bills re-date on first submission (APX-22)');
select matches(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'bills' and column_name = 'bill_date'),
  'Asia/Kolkata',
  'bills.bill_date defaults to the IST date, not UTC current_date'
);

-- ── Fixtures ─────────────────────────────────────────────────────────────────
insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount, billing_status, manual_complete_at, manual_complete_by)
values ('00000000-0000-4000-8000-00000000f901', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
        '00000000-0000-4000-8000-0000000000e1', 99901, 'pgTAP MAS phase', 50000, 50000, 'billable', now(), '00000000-0000-4000-8000-0000000000d2');

insert into public.stock_requests (id, org_id, project_id, package_id, phase_id, ref_no, material_name, qty, unit, rate, status, requested_by, created_by) values
  ('00000000-0000-4000-8000-00000000f911', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-00000000f901', 'SR-PGTAP-1', 'pgTAP material with phase', 4, 'bag', 1000, 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-00000000f912', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',
   null, 'SR-PGTAP-2', 'pgTAP package-level material', 4, 'bag', 1000, 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-00000000f913', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-00000000f901', 'SR-PGTAP-3', 'pgTAP material at zero rate', 4, 'bag', 0, 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-00000000f914', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',
   '00000000-0000-4000-8000-00000000f901', 'SR-PGTAP-4', 'pgTAP material with no rate', 4, 'bag', null, 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d5');

-- ── R1 / R4 / R6 in the view ─────────────────────────────────────────────────
select isnt_empty(
  $$ select 1 from public.v_billable_now where source_id = '00000000-0000-4000-8000-00000000f911' $$,
  'a rated material of an unbilled phase is billable'
);
select is_empty(
  $$ select 1 from public.v_billable_now where source_id = '00000000-0000-4000-8000-00000000f912' $$,
  'R4: package-level material (no phase) is not billed as an advance'
);
select is_empty(
  $$ select 1 from public.v_billable_now where source_id in ('00000000-0000-4000-8000-00000000f913', '00000000-0000-4000-8000-00000000f914') $$,
  'R6: a material with a zero or null rate is not billable (APX-14)'
);

-- Put the material on a DRAFT bill: its phase is now blocked (R3).
insert into public.bills (id, org_id, project_id, seq_no, bill_no, gst_rate_pct, retention_pct, tds_pct, created_by)
values ('00000000-0000-4000-8000-00000000f921', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
        99921, 'RA-PGTAP-DRAFT', 18, 5, 0, '00000000-0000-4000-8000-0000000000d2');
insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, pct_billed, amount)
values ('00000000-0000-4000-8000-00000000f921', 'material', '00000000-0000-4000-8000-00000000f911', 'pgTAP', 4000, 75, 3000);

select is(
  (select blocked_by_bill_no from public.v_billable_now where source_id = '00000000-0000-4000-8000-00000000f901'),
  'RA-PGTAP-DRAFT',
  'R3: a phase whose material is on a draft names that draft, and recovers nothing from it'
);

-- Submit that bill: the phase is unblocked and recovers the advance.
update public.bills set status = 'submitted', submitted_at = now() where id = '00000000-0000-4000-8000-00000000f921';
select is(
  (select mas_recovery from public.v_billable_now where source_id = '00000000-0000-4000-8000-00000000f901'),
  3000.00::numeric,
  'a committed material advance is the phase''s mas_recovery'
);

-- Bill the phase: a later material of it never becomes billable (R1).
insert into public.bills (id, org_id, project_id, seq_no, bill_no, gst_rate_pct, retention_pct, tds_pct, created_by)
values ('00000000-0000-4000-8000-00000000f922', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1',
        99922, 'RA-PGTAP-PHASE', 18, 5, 0, '00000000-0000-4000-8000-0000000000d2');
insert into public.bill_lines (bill_id, source_type, source_id, description, client_value, pct_billed, amount)
values ('00000000-0000-4000-8000-00000000f922', 'phase', '00000000-0000-4000-8000-00000000f901', 'pgTAP', 50000, 100, 50000);
insert into public.stock_requests (id, org_id, project_id, package_id, phase_id, ref_no, material_name, qty, unit, rate, status, requested_by, created_by)
values ('00000000-0000-4000-8000-00000000f915', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',
        '00000000-0000-4000-8000-00000000f901', 'SR-PGTAP-5', 'pgTAP material after its phase was billed', 2, 'bag', 1000, 'delivered',
        '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d5');
select is_empty(
  $$ select 1 from public.v_billable_now where source_id = '00000000-0000-4000-8000-00000000f915' $$,
  'R1: material for a phase already on a bill is not billable again'
);

select * from finish();
rollback;
