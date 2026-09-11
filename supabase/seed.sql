-- Demo dataset. Contains no real client data beyond Apex's own legal details.
-- NEVER load into production.
--
-- Translates docs/reference/prototype-dataset.ts per 02-lld.md §11, so a
-- developer sees a familiar system after `pnpm db:reset`.
--
-- Idempotent throughout (`on conflict do nothing`), and every id is fixed, so
-- pgTAP and Playwright reference rows by id rather than by position. Randomly
-- generated seed ids make every test flaky.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ ⚠ THE org ROW BELOW IS A PLACEHOLDER AND MUST BE REPLACED.               │
-- │                                                                          │
-- │ legal_name, gstin, pan and address print on every tax invoice this        │
-- │ system issues. Build 02 §0 asks for Apex Studios' real legal identity and │
-- │ it has not been supplied. `pnpm test` fails while the placeholder stands  │
-- │ (lib/../tests/seed-invariants) so this cannot ship unnoticed.             │
-- └──────────────────────────────────────────────────────────────────────────┘

-- ── Fixed ids ────────────────────────────────────────────────────────────────
-- Scheme: 0000-0000-4000-8000-<entity><nn>. Readable in a failing test.
--   org  a0   client b0   project c0   profile d0
--   package e0   phase f0   task 10   request 20   approval 30
--   bill 40   line 50   inventory 60   update 70

-- ── Organisation ─────────────────────────────────────────────────────────────
insert into public.orgs (id, name, legal_name, gstin, pan, address) values
  ('00000000-0000-4000-8000-0000000000a0',
   'Apex Studios',
   'PLACEHOLDER — Apex Studios legal name required',
   'PLACEHOLDER-GSTIN',
   'PLACEHOLDER-PAN',
   'PLACEHOLDER — registered address required')
on conflict (id) do nothing;

-- ── Auth users ───────────────────────────────────────────────────────────────
-- Seeded directly into auth.users so profiles has something to reference.
-- Build 03 replaces this with real invitations; there is no public sign-up
-- (01-hld.md §6), so this is a development affordance, not the real path.
-- Password for every seeded account: apex-dev-only
-- The four empty-string columns below are NOT cosmetic. GoTrue's own sign-in
-- query fails with a generic "Database error querying schema" (a 500, not an
-- invalid-credentials error) when confirmation_token, recovery_token,
-- email_change or email_change_token_new are NULL rather than ''. A row
-- created through auth.admin.createUser() never has this problem — Go sets
-- these explicitly — which is exactly what made this invisible until the
-- first real sign-in attempt against a seeded account
-- (build/03-auth-and-rbac.md, found while building the Playwright login
-- journeys). Confirmed by fixing it live on apex-dev, then here.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  v.email, extensions.crypt('apex-dev-only', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  '', '', '', ''
from (values
  ('00000000-0000-4000-8000-0000000000d1'::uuid, 'hello@beapex.in'),
  ('00000000-0000-4000-8000-0000000000d2'::uuid, 'suresh@beapex.in'),
  ('00000000-0000-4000-8000-0000000000d3'::uuid, 'prakash@beapex.in'),
  ('00000000-0000-4000-8000-0000000000d4'::uuid, 'meena@beapex.in'),
  ('00000000-0000-4000-8000-0000000000d5'::uuid, 'ravi@beapex.in'),
  ('00000000-0000-4000-8000-0000000000d6'::uuid, 'tvrao@example.invalid')
) as v(id, email)
on conflict (id) do nothing;

-- ── Profiles ─────────────────────────────────────────────────────────────────
-- D8: John Israel Voola is owner; Suresh K, Prakash R and Meena D are admin.
-- The prototype listed John as "admin"; the decision supersedes it.
-- Ravi's contact in the prototype was a masked phone, not an email, which is why
-- profiles_contact_ck accepts either.
insert into public.profiles (id, org_id, full_name, email, phone, role) values
  ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a0', 'John Israel Voola', 'hello@beapex.in',   null, 'owner'),
  ('00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000a0', 'Suresh K',          'suresh@beapex.in',  null, 'admin'),
  ('00000000-0000-4000-8000-0000000000d3', '00000000-0000-4000-8000-0000000000a0', 'Prakash R',         'prakash@beapex.in', null, 'admin'),
  ('00000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000a0', 'Meena D',           'meena@beapex.in',   null, 'admin'),
  ('00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000a0', 'Ravi',              'ravi@beapex.in',    '+910000000000', 'site'),
  ('00000000-0000-4000-8000-0000000000d6', '00000000-0000-4000-8000-0000000000a0', 'T V Rao',           'tvrao@example.invalid', null, 'client')
on conflict (id) do nothing;

-- ── Client ───────────────────────────────────────────────────────────────────
insert into public.clients (id, org_id, name, contact_person, email, billing_address) values
  ('00000000-0000-4000-8000-0000000000b0', '00000000-0000-4000-8000-0000000000a0',
   'T V Rao Housing Pvt Ltd', 'T V Rao', 'tvrao@example.invalid', 'Ghanpur, Hyderabad')
on conflict (id) do nothing;

-- ── Projects ─────────────────────────────────────────────────────────────────
-- The prototype's second project is "Quoted" with start: null, but
-- projects.start_date is NOT NULL in 02-lld.md §3.2. Seeded with the quote date
-- and flagged: a quoted project genuinely has no start date, so either the
-- column should be nullable or 'planning' projects need a different shape.
-- Raised for Build 04; not resolved here.
insert into public.projects (
  id, org_id, client_id, code, name, location, status, start_date, contract_value,
  gst_rate_pct, retention_pct, mas_billable_pct, tds_pct
) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a0',
   '00000000-0000-4000-8000-0000000000b0', 'BHEL-NCH', 'BHEL Nagnar Club House',
   'Ghanpur, Hyderabad', 'active', date '2026-08-24', 58800000,
   18.000, 5.000, 75.000, 0.000),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000a0',
   '00000000-0000-4000-8000-0000000000b0', 'BHEL-ARCH', 'BHEL Nagnar Entrance Arch',
   'Ghanpur, Hyderabad', 'planning', date '2026-09-01', 3700000,
   18.000, 5.000, 75.000, 0.000)
on conflict (id) do nothing;

-- Only site and client need membership rows. owner and admin are implicit
-- members of every project in their org (02-lld.md §3.2).
insert into public.project_members (project_id, profile_id) values
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000d6'),
  ('00000000-0000-4000-8000-0000000000c2', '00000000-0000-4000-8000-0000000000d6')
on conflict do nothing;

-- ── Packages ─────────────────────────────────────────────────────────────────
-- The prototype calls these "modules". Money transcribed exactly; these figures
-- are the reference for the Build 04 visual-parity check.
insert into public.packages (id, org_id, project_id, seq_no, name, lead_profile_id, allocated_amount, internal_amount, status) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 1, 'Swimming Pool',                 '00000000-0000-4000-8000-0000000000d2',  4500000,  2584054, 'in_progress'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 2, 'Facade and Windows',            '00000000-0000-4000-8000-0000000000d3',  7200000,  4992470, 'not_started'),
  ('00000000-0000-4000-8000-0000000000e3', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 3, 'Interiors',                     null,                                   18000000, 12500000, 'design'),
  ('00000000-0000-4000-8000-0000000000e4', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 4, 'External Development and Lift', '00000000-0000-4000-8000-0000000000d3', 12800000,  7965000, 'not_started'),
  ('00000000-0000-4000-8000-0000000000e5', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 5, 'MEP',                           null,                                   13800000,  8463365, 'not_started'),
  ('00000000-0000-4000-8000-0000000000e6', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 6, 'Plastering and Putty',          null,                                    2500000,  2000000, 'not_started'),
  ('00000000-0000-4000-8000-0000000000e7', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c2', 1, 'Entrance Arch',                 null,                                    3700000,  2660000, 'not_started')
on conflict (id) do nothing;

-- ── Phases ───────────────────────────────────────────────────────────────────
-- The prototype calls these "packages". Its p1..p10 / f1..f9 / i1..i14 / e1..e2
-- / m1..m7 / c1..c2 map to the seq_no column here.
insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount) values
  -- Swimming Pool
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  1, 'Surface preparation and waterproofing', 560000, 319630),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  2, 'Pool tiling',                         1175000, 679330),
  ('00000000-0000-4000-8000-0000000000f3', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  3, 'Deck finishes',                        315000, 182900),
  ('00000000-0000-4000-8000-0000000000f4', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  4, 'Overflow channel and balance tank',    315000, 159380),
  ('00000000-0000-4000-8000-0000000000f5', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  5, 'Filtration plant',                     830000, 522560),
  ('00000000-0000-4000-8000-0000000000f6', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  6, 'Pool plumbing',                        410000, 222100),
  ('00000000-0000-4000-8000-0000000000f7', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  7, 'Water treatment',                      118000,  59220),
  ('00000000-0000-4000-8000-0000000000f8', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  8, 'Pool electricals and lighting',        440000, 248220),
  ('00000000-0000-4000-8000-0000000000f9', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1',  9, 'Pool accessories',                     277000, 156831),
  ('00000000-0000-4000-8000-0000000000fa', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', 10, 'Testing, commissioning and handover',   60000,  33883),
  -- Facade and Windows
  ('00000000-0000-4000-8000-000000000f11', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  1, 'Surface preparation and plaster repairs', 189300,  142000),
  ('00000000-0000-4000-8000-000000000f12', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  2, 'Brick-tile cladding',                   1981836, 1423220),
  ('00000000-0000-4000-8000-000000000f13', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  3, 'Exterior painting',                      301035,  224175),
  ('00000000-0000-4000-8000-000000000f14', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  4, 'Facade lighting',                        514700,  386000),
  ('00000000-0000-4000-8000-000000000f15', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  5, 'Balcony and parapet railings',           260100,  195075),
  ('00000000-0000-4000-8000-000000000f16', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  6, 'Entrance canopy and signage',            413300,  310000),
  ('00000000-0000-4000-8000-000000000f17', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  7, 'Scaffolding and cleaning',               696000,  522000),
  ('00000000-0000-4000-8000-000000000f18', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  8, 'Aluminium windows and ventilators',     2623729, 1625000),
  ('00000000-0000-4000-8000-000000000f19', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2',  9, 'Supervision',                            220000,  165000),
  -- MEP (kept because the notification and billable views want more than one package with phases)
  ('00000000-0000-4000-8000-000000000f51', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  1, 'Electrical distribution and wiring', 6850000, 4119450),
  ('00000000-0000-4000-8000-000000000f52', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  2, 'Air conditioning',                  3100000, 1891215),
  ('00000000-0000-4000-8000-000000000f53', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  3, 'Ventilation and exhaust',            525000,  317600),
  ('00000000-0000-4000-8000-000000000f54', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  4, 'Water supply and plumbing',         1340000,  809600),
  ('00000000-0000-4000-8000-000000000f55', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  5, 'Drainage and rainwater',             900000,  542200),
  ('00000000-0000-4000-8000-000000000f56', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  6, 'ELV and CCTV',                       635000,  383300),
  ('00000000-0000-4000-8000-000000000f57', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e5',  7, 'Testing and commissioning',          650000,  400000),
  -- Plastering and Putty
  ('00000000-0000-4000-8000-000000000f61', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e6',  1, 'Internal wall plastering', 1740000, 1392000),
  ('00000000-0000-4000-8000-000000000f62', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e6',  2, 'Wall and ceiling putty',    760000,  608000)
on conflict (id) do nothing;

-- ── Tasks ────────────────────────────────────────────────────────────────────
-- CONVERSION, and Build 05 depends on it (02-lld.md §3.3, ADR-011):
--   start_date     = project.start_date + (w - 1) * 7
--   duration_weeks = d
-- The prototype's 14-week integer grid becomes real dates; the grid is a
-- scrolling viewport over them, derived as floor((start - project.start) / 7).
--
-- Two prototype tasks carried no package ("Tile sample approval", "Handover").
-- tasks.phase_id is NOT NULL, so they are attached to the phase they obviously
-- belong to: tile sample to Pool tiling, handover to Testing and commissioning.
--
-- Phase 1 has both its tasks at 100%, which is what makes Billable Now non-empty
-- and gives Build 09 something to develop against. Do not let that regress —
-- tests/seed-invariants asserts it.
insert into public.tasks (id, org_id, project_id, package_id, phase_id, name, start_date, duration_weeks, progress_pct)
select
  v.id,
  '00000000-0000-4000-8000-0000000000a0',
  '00000000-0000-4000-8000-0000000000c1',
  '00000000-0000-4000-8000-0000000000e1',
  v.phase_id,
  v.name,
  date '2026-08-24' + ((v.w - 1) * 7),
  v.d,
  v.p
from (values
  ('00000000-0000-4000-8000-000000000101'::uuid, '00000000-0000-4000-8000-0000000000f1'::uuid, 'Surface prep and repairs',                 1, 2, 100),
  ('00000000-0000-4000-8000-000000000102'::uuid, '00000000-0000-4000-8000-0000000000f1'::uuid, 'Waterproofing, 2 coats and ponding test',  2, 3, 100),
  ('00000000-0000-4000-8000-000000000103'::uuid, '00000000-0000-4000-8000-0000000000f4'::uuid, 'Overflow channel and balance tank',        3, 3,   0),
  ('00000000-0000-4000-8000-000000000104'::uuid, '00000000-0000-4000-8000-0000000000f6'::uuid, 'Pool plumbing rough-in',                   3, 3,   0),
  ('00000000-0000-4000-8000-000000000105'::uuid, '00000000-0000-4000-8000-0000000000f2'::uuid, 'Tile sample approval',                     4, 1,   0),
  ('00000000-0000-4000-8000-000000000106'::uuid, '00000000-0000-4000-8000-0000000000f2'::uuid, 'Pool tiling',                              5, 5,   0),
  ('00000000-0000-4000-8000-000000000107'::uuid, '00000000-0000-4000-8000-0000000000f3'::uuid, 'Deck screed and anti-skid',                8, 3,   0),
  ('00000000-0000-4000-8000-000000000108'::uuid, '00000000-0000-4000-8000-0000000000f5'::uuid, 'Filtration plant order',                   3, 1,   0),
  ('00000000-0000-4000-8000-000000000109'::uuid, '00000000-0000-4000-8000-0000000000f5'::uuid, 'Plant room installation',                  9, 3,   0),
  ('00000000-0000-4000-8000-00000000010a'::uuid, '00000000-0000-4000-8000-0000000000f8'::uuid, 'Underwater lights and cabling',            9, 3,   0),
  ('00000000-0000-4000-8000-00000000010b'::uuid, '00000000-0000-4000-8000-0000000000f9'::uuid, 'Accessories and signage',                 11, 2,   0),
  ('00000000-0000-4000-8000-00000000010c'::uuid, '00000000-0000-4000-8000-0000000000fa'::uuid, 'Fill, commissioning, training',           12, 2,   0),
  ('00000000-0000-4000-8000-00000000010d'::uuid, '00000000-0000-4000-8000-0000000000fa'::uuid, 'Handover',                                13, 1,   0)
) as v(id, phase_id, name, w, d, p)
on conflict (id) do nothing;

-- ── Inventory ────────────────────────────────────────────────────────────────
-- Covers all three derived states: INV-03 and INV-07 at 0 (critical), INV-01,
-- INV-02 and INV-05 below reorder (low), the rest ok.
-- Units are the prototype's. Build 02 §0 asks Apex for the real unit list; when
-- it arrives, reconcile these and the dropdown in Build 07.
insert into public.inventory_items (id, org_id, project_id, name, category, sku, unit, qty_on_hand, reorder_level, unit_cost, location) values
  ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Ultratech 53 grade cement, 50 kg',   'Cement & Aggregates', 'INV-01', 'bag',    40,  50,  395, 'Site store'),
  ('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Dr. Fixit Pidifin 2K, 20 kg kit',    'Waterproofing',       'INV-02', 'kit',     5,  10, 4050, 'Site store'),
  ('00000000-0000-4000-8000-000000000603', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Pool-grade vitrified tile 300x300',  'Tiling',              'INV-03', 'sft',     0, 500,  165, 'Site store'),
  ('00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'uPVC pipe 63 mm SCH 80, 3 m',        'Plumbing',            'INV-04', 'len',    45,  20,  640, 'Site store'),
  ('00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Bonding agent, SBR latex 20 L',      'Waterproofing',       'INV-05', 'can',     3,   5, 2100, 'Site store'),
  ('00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Cup-lock scaffolding',               'Scaffolding',         'INV-06', 'sqm',  1100, 500,  150, 'Facade yard'),
  ('00000000-0000-4000-8000-000000000607', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Aluminium window profile',           'Facade',              'INV-07', 'rft',     0, 200,  850, 'Warehouse'),
  ('00000000-0000-4000-8000-000000000608', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 'Tile adhesive, pool grade, 20 kg',   'Tiling',              'INV-08', 'bag',    60,  40,  380, 'Site store')
on conflict (id) do nothing;

-- ── Stock requests ───────────────────────────────────────────────────────────
-- The prototype has only pending, delivered and rejected. Build 02 §4.9 requires
-- all five statuses present or Build 07 has states it cannot develop against, so
-- SR-015 (approved) and SR-016 (ordered) are added here. Everything from the
-- prototype is transcribed exactly.
-- ref_no follows D6's project-scoped convention rather than the prototype's
-- bare SR-014.
insert into public.stock_requests (id, org_id, project_id, package_id, phase_id, ref_no, material_name, qty, unit, rate, needed_by, status, requested_by, approved_by, approved_at, ordered_at, delivered_by, delivered_at, rejected_reason, created_at) values
  ('00000000-0000-4000-8000-000000000214', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f2', 'SR-BHEL-NCH-014', 'Pool-grade vitrified tile 300x300, anti-skid', 1200, 'sft',  165, date '2026-10-05', 'pending',   '00000000-0000-4000-8000-0000000000d5', null, null, null, null, null, null, timestamptz '2026-09-06 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000213', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'SR-BHEL-NCH-013', 'Dr. Fixit Pidifin 2K, 20 kg kit',                40, 'kit', 4050, date '2026-09-08', 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-03 10:00+05:30', timestamptz '2026-09-04 10:00+05:30', '00000000-0000-4000-8000-0000000000d5', timestamptz '2026-09-07 10:00+05:30', null, timestamptz '2026-09-02 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'SR-BHEL-NCH-012', 'Ultratech 53 grade cement, 50 kg',              120, 'bag',  395, date '2026-08-27', 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-08-26 10:00+05:30', timestamptz '2026-08-26 14:00+05:30', '00000000-0000-4000-8000-0000000000d5', timestamptz '2026-08-28 10:00+05:30', null, timestamptz '2026-08-25 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000211', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'SR-BHEL-NCH-011', 'Bonding agent, SBR latex 20 L',                  10, 'can', 2100, date '2026-08-29', 'delivered', '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-08-26 10:00+05:30', timestamptz '2026-08-26 14:00+05:30', '00000000-0000-4000-8000-0000000000d5', timestamptz '2026-08-29 10:00+05:30', null, timestamptz '2026-08-25 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000210', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f6', 'SR-BHEL-NCH-010', 'uPVC pipe 63 mm SCH 80, 3 m',                    60, 'len',  640, date '2026-09-12', 'pending',   '00000000-0000-4000-8000-0000000000d5', null, null, null, null, null, null, timestamptz '2026-09-06 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000209', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', null,                                   'SR-BHEL-NCH-009', 'Vitrified tile sample set',                       1, 'set',    0, date '2026-09-10', 'rejected',  '00000000-0000-4000-8000-0000000000d5', null, null, null, null, null, 'Samples to come from the vendor at no cost; no purchase needed.', timestamptz '2026-09-01 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000215', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f5', 'SR-BHEL-NCH-015', 'Filtration plant, 30 m3/hr package',               1, 'nos', 385000, date '2026-10-19', 'approved',  '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-08 10:00+05:30', null, null, null, null, timestamptz '2026-09-07 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000216', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f8', 'SR-BHEL-NCH-016', 'Underwater LED light, IP68, 18 W',                9, 'nos',  8400, date '2026-10-26', 'ordered',   '00000000-0000-4000-8000-0000000000d5', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-08 10:00+05:30', timestamptz '2026-09-08 15:00+05:30', null, null, null, timestamptz '2026-09-07 09:00+05:30')
on conflict (id) do nothing;

-- Delivered requests link back to the item they delivered — a real delivery
-- (rpc_transition_stock_request) always sets this; these three rows predate
-- that RPC, so it's set by hand here for the same referential completeness.
update public.stock_requests set inventory_item_id = '00000000-0000-4000-8000-000000000605' where id = '00000000-0000-4000-8000-000000000211';
update public.stock_requests set inventory_item_id = '00000000-0000-4000-8000-000000000601' where id = '00000000-0000-4000-8000-000000000212';
update public.stock_requests set inventory_item_id = '00000000-0000-4000-8000-000000000602' where id = '00000000-0000-4000-8000-000000000213';

-- ── Stock movements: opening balance ─────────────────────────────────────────
-- D32 (docs/decisions.md): every inventory_items row above was seeded with a
-- qty_on_hand directly, with no stock_movements behind it — a real delivery
-- (SR-011/012/013 above) put some of it there, but each item's CURRENT
-- quantity doesn't equal what was delivered (site consumption between then
-- and the seed's own "today" was never modelled, and never asked for).
-- Build 07's inventory.reconcile job recomputes qty_on_hand from this ledger
-- and alerts on any disagreement — without a ledger behind the seed, it
-- would alert on all eight items on its very first run, which is noise, not
-- a finding. One 'in' / ref_type='adjustment' movement per item, sized to
-- match its own seeded qty_on_hand exactly, is the same thing a real opening
-- balance migration would write (build §0's own "opening adjust movements"),
-- just backdated to the seed's own "today" rather than reconstructing a
-- history nobody specified.
insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, unit_cost, ref_type, reason, created_at, created_by) values
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-0000000000c1', 'in', 40,   395,  'adjustment', 'Opening balance (seed)', timestamptz '2026-08-24 09:00+05:30', '00000000-0000-4000-8000-0000000000d2'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-0000000000c1', 'in', 5,    4050, 'adjustment', 'Opening balance (seed)', timestamptz '2026-08-24 09:00+05:30', '00000000-0000-4000-8000-0000000000d2'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000604', '00000000-0000-4000-8000-0000000000c1', 'in', 45,   640,  'adjustment', 'Opening balance (seed)', timestamptz '2026-08-24 09:00+05:30', '00000000-0000-4000-8000-0000000000d2'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000605', '00000000-0000-4000-8000-0000000000c1', 'in', 3,    2100, 'adjustment', 'Opening balance (seed)', timestamptz '2026-08-24 09:00+05:30', '00000000-0000-4000-8000-0000000000d2'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000606', '00000000-0000-4000-8000-0000000000c1', 'in', 1100, 150,  'adjustment', 'Opening balance (seed)', timestamptz '2026-08-24 09:00+05:30', '00000000-0000-4000-8000-0000000000d2'),
  ('00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000608', '00000000-0000-4000-8000-0000000000c1', 'in', 60,   380,  'adjustment', 'Opening balance (seed)', timestamptz '2026-08-24 09:00+05:30', '00000000-0000-4000-8000-0000000000d2');
-- 603 (Pool-grade vitrified tile) and 607 (Aluminium window profile) both
-- seed at qty_on_hand = 0 — the ledger already agrees with no rows at all,
-- so they get none.

-- ── Approvals ────────────────────────────────────────────────────────────────
-- The prototype has pending and approved. §4.9 requires a rejected one too, so
-- AP-005 is added; the other four are transcribed.
insert into public.approvals (id, org_id, project_id, package_id, phase_id, ref_no, type, item, note, needed_by, status, requested_by, decided_by, decided_at, decision_reason, created_at) values
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f2', 'AP-BHEL-NCH-004', 'material_sample', 'Pool tile, ivory 300x300 anti-skid (Kajaria), coping in matching bullnose', 'Sample board at site office. Holds tiling start on W5.', date '2026-09-14', 'pending',  '00000000-0000-4000-8000-0000000000d2', null, null, null, timestamptz '2026-09-05 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f8', 'AP-BHEL-NCH-003', 'make_model',      'Underwater lights: 9 nos IP68 LED, Astral in place of Pentair',            'Deviation from quoted make. Same lumen and warranty.',  date '2026-09-20', 'pending',  '00000000-0000-4000-8000-0000000000d2', null, null, null, timestamptz '2026-09-04 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', 'AP-BHEL-NCH-002', 'material_sample', 'Waterproofing system: Dr. Fixit Pidifin 2K, two coats',                    null, date '2026-08-30', 'approved', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d6', timestamptz '2026-08-28 11:00+05:30', null, timestamptz '2026-08-26 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-000000000f12', 'AP-BHEL-NCH-001', 'drawing',        'Facade family: dark grey granite, brass jali, dark grey ACP band (Option B)', null, date '2026-09-05', 'approved', '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d6', timestamptz '2026-09-02 11:00+05:30', null, timestamptz '2026-08-30 09:00+05:30'),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f3', 'AP-BHEL-NCH-005', 'material_sample', 'Deck anti-skid finish, dark grey, matt',                                   null, date '2026-09-12', 'rejected', '00000000-0000-4000-8000-0000000000d2', '00000000-0000-4000-8000-0000000000d6', timestamptz '2026-09-08 11:00+05:30', 'Too dark against the coping. Send two lighter options.', timestamptz '2026-09-06 09:00+05:30')
on conflict (id) do nothing;

-- ── Daily updates ────────────────────────────────────────────────────────────
insert into public.daily_updates (id, org_id, project_id, package_id, update_date, body, author_id) values
  ('00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', date '2026-09-07', 'Second coat of Pidifin on pool floor and walls done, 1,600 sft. Balance tank first coat started. Ponding test planned for Thursday.', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', date '2026-09-06', 'First coat waterproofing completed on main pool walls. Kids pool surface prep finished. Two honeycomb patches repaired near the deep end.', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e1', date '2026-09-05', 'Cement received, 120 bags. Surface grinding and cleaning complete on main pool. Started primer.', '00000000-0000-4000-8000-0000000000d5'),
  ('00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e2', date '2026-09-04', 'Scaffolding vendor measured the north face. Plaster repair marking done with the architect.', '00000000-0000-4000-8000-0000000000d5')
on conflict (id) do nothing;

-- ── Bills ────────────────────────────────────────────────────────────────────
-- The prototype has one Paid and two Submitted. §4.9 requires draft, submitted,
-- certified and paid, so RA-004 (draft) and RA-005 (certified) are added.
--
-- Numbering follows D6: RA-{project_code}-{n}. The prototype's bare RA-001 is
-- superseded by that decision.
--
-- ⚠ THE ARITHMETIC BELOW IS TRANSCRIBED, NOT COMPUTED.
-- The prototype's billTotals() deducts retention BEFORE GST, which HLD §8.4 and
-- ADR-005 say is wrong: under Indian GST, retention is part of the value of the
-- supply. These rows use the CORRECTED order —
--   taxable = gross - mas_recovery ; gst = taxable * rate ; invoice = taxable + gst
--   net = invoice - retention - tds - advance_recovery
-- so they will not match the prototype's on-screen totals. That is intentional
-- and is the bug the prototype had. rpc_create_bill (Build 09) is what computes
-- these for real, with 100% branch coverage; this seed only has to be internally
-- consistent and correctly ordered.
--
-- A second finding while transcribing: the prototype's billTotals() computes
-- cost as `Σ lineCost − round(recovery * 0.6)`. That 0.6 is a magic number with
-- no basis anywhere in the HLD or the LLD, and it is what makes the prototype
-- show RA-002's margin as ₹2,28,210 where taxable − internal_cost gives
-- ₹1,56,308. margin_amount here follows the LLD (taxable − internal_cost).
-- Build 09 has to decide what recovery does to margin; it is a real question,
-- not a rounding difference.
insert into public.bills (
  id, org_id, project_id, seq_no, bill_no, bill_date, status,
  work_value, material_value, gross_amount, mas_recovery_amount, taxable_amount,
  gst_amount, invoice_total, retention_amount, tds_amount, advance_recovery, net_payable,
  gst_rate_pct, retention_pct, tds_pct, internal_cost_amount, margin_amount,
  created_by, submitted_at, submitted_by, certified_at, certified_by, paid_at
) values
  -- RA-1: two material lines at 75%. 83,045*.75 + 36,792*.75 = 89,877.75.
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 1, 'RA-BHEL-NCH-1', date '2026-08-30', 'paid',
   0, 89877.75, 89877.75, 0, 89877.75,
   16178.00, 106055.75, 4493.89, 0, 0, 101561.86,
   18.000, 5.000, 0.000, 51300.00, 38577.75,
   '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-08-30 12:00+05:30', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-02 12:00+05:30', '00000000-0000-4000-8000-0000000000d6', timestamptz '2026-09-04 12:00+05:30'),
  -- RA-2: phase 1 complete (560,000) plus material 84,375, less the 119,837
  -- advanced earlier and now embedded in that phase. The MAS recovery is what
  -- stops the same material being billed twice (HLD §8.4 step D).
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 2, 'RA-BHEL-NCH-2', date '2026-09-05', 'submitted',
   560000.00, 84375.00, 644375.00, 119837.00, 524538.00,
   94416.84, 618954.84, 26226.90, 0, 0, 592727.94,
   18.000, 5.000, 0.000, 368230.00, 156308.00,
   '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-05 12:00+05:30', '00000000-0000-4000-8000-0000000000d2', null, null, null),
  -- RA-3: scaffolding at 75%.
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 3, 'RA-BHEL-NCH-3', date '2026-09-06', 'submitted',
   0, 180000.00, 180000.00, 0, 180000.00,
   32400.00, 212400.00, 9000.00, 0, 0, 203400.00,
   18.000, 5.000, 0.000, 135000.00, 45000.00,
   '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-06 12:00+05:30', '00000000-0000-4000-8000-0000000000d2', null, null, null),
  -- RA-4: draft, so every figure is zero until rpc_create_bill fills it.
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 4, 'RA-BHEL-NCH-4', date '2026-09-09', 'draft',
   0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
   18.000, 5.000, 0.000, 0, 0,
   '00000000-0000-4000-8000-0000000000d2', null, null, null, null, null),
  -- RA-5: certified but unpaid, so the Outstanding tile has something in it.
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', 5, 'RA-BHEL-NCH-5', date '2026-09-08', 'certified',
   0, 60000.00, 60000.00, 0, 60000.00,
   10800.00, 70800.00, 3000.00, 0, 0, 67800.00,
   18.000, 5.000, 0.000, 45000.00, 15000.00,
   '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-08 12:00+05:30', '00000000-0000-4000-8000-0000000000d2', timestamptz '2026-09-09 12:00+05:30', '00000000-0000-4000-8000-0000000000d6', null)
on conflict (id) do nothing;

-- Keep projects.next_bill_seq ahead of the seeded bills, or rpc_create_bill's
-- first real call collides on bills_seq_uq.
update public.projects set next_bill_seq = 6
 where id = '00000000-0000-4000-8000-0000000000c1' and next_bill_seq < 6;

-- Same gap, one build later: next_sr_seq defaulted to 1 (migration
-- 20260913090001) when this column was added long after SR-BHEL-NCH-001
-- through -016 were already seeded above. Confirmed live: rpc_create_stock_request's
-- first real calls allocated SR-BHEL-NCH-001..008 successfully (nothing seeded
-- at those exact numbers was still in a state to collide) and then failed with
-- a raw sr_ref_uq duplicate-key error on SR-BHEL-NCH-009 — the same class of
-- oversight next_bill_seq's own fix above exists for, just missed when this
-- build added the column.
update public.projects set next_sr_seq = 17
 where id = '00000000-0000-4000-8000-0000000000c1' and next_sr_seq < 17;

insert into public.bill_lines (id, bill_id, source_type, source_id, description, client_value, pct_billed, amount, internal_cost, sort_order) values
  ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000401', 'material', '00000000-0000-4000-8000-000000000212', 'SR-BHEL-NCH-012 Ultratech 53 grade cement, 120 bag',  83045, 75,  62283.75,  35550.00, 1),
  ('00000000-0000-4000-8000-000000000502', '00000000-0000-4000-8000-000000000401', 'material', '00000000-0000-4000-8000-000000000211', 'SR-BHEL-NCH-011 Bonding agent, SBR latex, 10 can',    36792, 75,  27594.00,  15750.00, 2),
  ('00000000-0000-4000-8000-000000000503', '00000000-0000-4000-8000-000000000402', 'phase',    '00000000-0000-4000-8000-0000000000f1', 'Surface preparation and waterproofing complete',     560000, 100, 560000.00, 319630.00, 1),
  ('00000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000402', 'material', '00000000-0000-4000-8000-000000000213', 'SR-BHEL-NCH-013 Dr. Fixit Pidifin 2K, 40 kit',       112500, 75,  84375.00,  48600.00, 2),
  ('00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000403', 'manual',   null,                                    'Cup-lock scaffolding, 1,200 sqm',                   240000, 75, 180000.00, 135000.00, 1),
  ('00000000-0000-4000-8000-000000000506', '00000000-0000-4000-8000-000000000405', 'manual',   null,                                    'Water treatment dosing set',                         80000, 75,  60000.00,  45000.00, 1)
on conflict (id) do nothing;

-- The bill lines above claim these requests, so mark them billed. Without this
-- they reappear in Billable Now and idx_bill_lines_source blocks the next bill.
update public.stock_requests set billed_on_bill_id = '00000000-0000-4000-8000-000000000401'
 where id in ('00000000-0000-4000-8000-000000000212', '00000000-0000-4000-8000-000000000211')
   and billed_on_bill_id is null;
update public.stock_requests set billed_on_bill_id = '00000000-0000-4000-8000-000000000402'
 where id = '00000000-0000-4000-8000-000000000213' and billed_on_bill_id is null;

-- Phase 1 is on RA-2, so its billing status reflects that rather than staying
-- 'unresolved' and reappearing in Billable Now.
update public.phases set billing_status = 'billed'
 where id = '00000000-0000-4000-8000-0000000000f1' and billing_status = 'unresolved';

insert into public.payments (id, org_id, bill_id, amount, paid_on, mode, reference_no, created_by) values
  ('00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-000000000401', 101561.86, date '2026-09-04', 'neft', 'NEFT-2026-09-04-001', '00000000-0000-4000-8000-0000000000d2')
on conflict (id) do nothing;

-- ── Additional phases: Interiors and External Development and Lift ─────────
-- Build 04 (docs/build/04-projects-packages-phases.md) migrates the package
-- detail Budget tab onto real queries. Without these, v_phase_billing for
-- packages e3/e4 returns zero rows and the Budget tab would render empty for
-- Interiors and External Development — a real visual regression against
-- proto-v1, not a formatting difference. Names and values transcribed exactly
-- from docs/reference/prototype-dataset.ts.
insert into public.phases (id, org_id, project_id, package_id, seq_no, name, allocated_amount, internal_amount) values
  -- Interiors (package e3)
  ('00000000-0000-4000-8000-000000000f31', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  1, 'Flooring',                       3000000, 2500000),
  ('00000000-0000-4000-8000-000000000f32', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  2, 'Painting and finishes',          1100000,  900000),
  ('00000000-0000-4000-8000-000000000f33', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  3, 'False ceilings',                 1400000, 1100000),
  ('00000000-0000-4000-8000-000000000f34', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  4, 'Toilets and wet areas',          2200000, 1800000),
  ('00000000-0000-4000-8000-000000000f35', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  5, 'Doors and hardware',             1300000, 1000000),
  ('00000000-0000-4000-8000-000000000f36', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  6, 'Fixed joinery and mirrors',      1500000, 1000000),
  ('00000000-0000-4000-8000-000000000f37', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  7, 'Feature walls and partitions',   1000000,  800000),
  ('00000000-0000-4000-8000-000000000f38', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  8, 'Light fittings and fans',        1200000,  900000),
  ('00000000-0000-4000-8000-000000000f39', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3',  9, 'Project overhead',                600000,  600000),
  ('00000000-0000-4000-8000-00000000f3a0', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', 10, 'Function hall AV',                300000,  250000),
  ('00000000-0000-4000-8000-00000000f3a1', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', 11, 'Blinds and curtains',              200000,  150000),
  ('00000000-0000-4000-8000-00000000f3a2', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', 12, 'Loose furniture',                1000000,  800000),
  ('00000000-0000-4000-8000-00000000f3a3', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', 13, 'Gym equipment',                   500000,  450000),
  ('00000000-0000-4000-8000-00000000f3a4', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e3', 14, 'Indoor games tables',              300000,  250000),
  -- External Development and Lift (package e4)
  ('00000000-0000-4000-8000-000000000f41', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e4',  1, 'External development',           8500000, 5465000),
  ('00000000-0000-4000-8000-000000000f42', '00000000-0000-4000-8000-0000000000a0', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000e4',  2, 'Passenger lift',                 3500000, 2500000)
on conflict (id) do nothing;
