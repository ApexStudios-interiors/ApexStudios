-- 0006 — inventory and the movement ledger
--
-- 02-lld.md §3.4. D2: the simple model for v1, but every quantity change goes
-- through the append-only ledger so weighted-average costing is additive later
-- without a rewrite (ADR-003).

-- ── units ────────────────────────────────────────────────────────────────────
-- DEVIATION FROM 02-lld.md §3.4, amended there in this PR.
--
-- The LLD has `unit text not null` with the codes in a comment. Voola confirmed
-- the closed list on 2026-09-10, and free text over a closed vocabulary means
-- 'bag' and 'bags' silently become two materials that never reconcile — in a
-- table whose quantity feeds a bill. The column stays `text`; it just gains a
-- foreign key.
--
-- It also gives Build 07's unit dropdown something to read, instead of the list
-- being duplicated in TypeScript and drifting from the database.
--
-- To add a unit later: a migration inserting a row. Not a dashboard edit.
create table public.units (
  code       text primary key,
  label      text not null,
  sort_order int not null default 0
);

insert into public.units (code, label, sort_order) values
  ('bag', 'Bag',           1),
  ('sft', 'Square feet',   2),
  ('kit', 'Kit',           3),
  ('len', 'Length',        4),
  ('can', 'Can',           5),
  ('sqm', 'Square metre',  6),
  ('rft', 'Running feet',  7),
  ('nos', 'Numbers',       8),
  ('set', 'Set',           9);

alter table public.units enable row level security;
alter table public.units force row level security;

-- Readable by every signed-in user; there is nothing confidential in a unit
-- code. No write policy: the list changes by migration.
create policy units_select on public.units for select to authenticated
  using ( true );

create table public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.orgs(id),
  -- NULL means the central store rather than a project.
  project_id    uuid references public.projects(id) on delete cascade,
  name          text not null,
  category      text,
  sku           text,
  unit          text not null references public.units(code),
  qty_on_hand   numeric(14,3) not null default 0,  -- CACHE of stock_movements
  reorder_level numeric(14,3) not null default 0,
  unit_cost     numeric(14,2) not null default 0,  -- ADMIN/SITE only, never client
  location      text,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles(id),
  deleted_at    timestamptz,
  -- Negative stock is blocked outright, with no override. An issue that would
  -- take stock below zero is a data problem to fix, not a state to record.
  constraint inventory_qty_ck check (qty_on_hand >= 0),
  constraint inventory_rl_ck check (reorder_level >= 0),
  constraint inventory_cost_ck check (unit_cost >= 0),
  -- `nulls not distinct` requires Postgres 15+, so a central-store item (NULL
  -- project_id) still collides with another central-store item of the same sku.
  constraint inventory_sku_uq unique nulls not distinct (org_id, project_id, sku)
);

-- stock_status is NOT stored. AGENTS.md: do not store derived values that go
-- stale. v_inventory_status (0013) derives it from qty and reorder_level.

create index idx_inventory_project on public.inventory_items (project_id) where deleted_at is null;
create index idx_inventory_org_name on public.inventory_items (org_id, name) where deleted_at is null;
create index idx_inventory_org on public.inventory_items (org_id);

alter table public.inventory_items enable row level security;
alter table public.inventory_items force row level security;

-- Quantities are operational, so site reads them. unit_cost is not, which is
-- why the client never reaches this table at all and site reads it through
-- v_inventory_site (0014).
create policy inventory_select on public.inventory_items for select to authenticated
  using (
    deleted_at is null
    and org_id = public.auth_org()
    and public.auth_role() in ('owner', 'admin', 'site')
    and (project_id is null or public.is_member_of(project_id))
  );

create policy inventory_insert on public.inventory_items for insert to authenticated
  with check ( org_id = public.auth_org() and public.is_admin() );

-- No update policy. qty_on_hand moves only through rpc_adjust_inventory and the
-- stock-request RPCs (Build 07), which take a row lock and write the ledger in
-- the same transaction. An application-level read-modify-write is a race
-- condition (AGENTS.md database rule 4, ADR-012).

create trigger trg_inventory_updated_at before update on public.inventory_items
  for each row execute function public.trg_set_updated_at();

-- ── stock_movements ──────────────────────────────────────────────────────────
-- Append-only for every role including owner (ADR-007). A mistake is corrected
-- with a compensating 'adjust' movement carrying a reason, never an edit. This
-- is the ledger the nightly reconcile job checks qty_on_hand against.
create table public.stock_movements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.orgs(id),
  inventory_item_id uuid not null references public.inventory_items(id),
  project_id        uuid references public.projects(id),
  direction         public.movement_direction not null,
  -- Always positive; `direction` carries the sign. A signed qty plus a direction
  -- is two sources of truth for one fact.
  qty               numeric(14,3) not null,
  unit_cost         numeric(14,2) not null default 0,
  ref_type          text,                             -- 'stock_request','adjustment','transfer'
  ref_id            uuid,
  reason            text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.profiles(id),
  constraint movements_qty_ck check (qty > 0)
);

create index idx_movements_item on public.stock_movements (inventory_item_id, created_at desc);
create index idx_movements_ref on public.stock_movements (ref_type, ref_id);
create index idx_movements_org on public.stock_movements (org_id);
create index idx_movements_project on public.stock_movements (project_id);

alter table public.stock_movements enable row level security;
alter table public.stock_movements force row level security;

create policy movements_select on public.stock_movements for select to authenticated
  using (
    org_id = public.auth_org()
    and public.auth_role() in ('owner', 'admin', 'site')
    and (project_id is null or public.is_member_of(project_id))
  );

-- No insert, update or delete policy for ANY role, including owner.
-- The security-definer RPCs are the only way in. This is what stops a direct
-- PostgREST call from writing the ledger, even for an authenticated admin.
-- If someone later asks for a "fix a typo" path, the answer is a compensating
-- row, and this comment is the reason.
