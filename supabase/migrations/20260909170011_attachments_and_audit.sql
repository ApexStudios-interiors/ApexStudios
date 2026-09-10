-- 0011 — attachments and the audit log
--
-- 02-lld.md §3.9.

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.orgs(id),
  project_id   uuid references public.projects(id) on delete cascade,
  entity_type  public.attachment_entity not null,
  entity_id    uuid not null,
  r2_key       text not null unique,
  thumb_r2_key text,
  file_name    text not null,
  mime_type    text not null,
  size_bytes   bigint not null,
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  constraint att_size_ck check (size_bytes > 0 and size_bytes <= 26214400)  -- 25 MB
);

create index idx_att_entity on public.attachments (entity_type, entity_id) where deleted_at is null;
create index idx_att_project on public.attachments (project_id) where deleted_at is null;
create index idx_att_org on public.attachments (org_id);
create index idx_att_uploader on public.attachments (uploaded_by);

alter table public.attachments enable row level security;
alter table public.attachments force row level security;

create policy att_select on public.attachments for select to authenticated
  using ( deleted_at is null
          and (project_id is null or public.is_member_of(project_id))
          and org_id = public.auth_org() );

create policy att_insert on public.attachments for insert to authenticated
  with check ( (project_id is null or public.is_member_of(project_id))
               and uploaded_by = auth.uid()
               and org_id = public.auth_org() );

-- The uploader may remove their own file for 24 hours, matching daily updates.
-- After that it is evidence attached to an approval or a bill.
create policy att_delete_uploader on public.attachments for delete to authenticated
  using ( uploaded_by = auth.uid() and created_at > now() - interval '24 hours' );

-- ── audit_log ────────────────────────────────────────────────────────────────
-- Append-only for every role including owner (ADR-007). Written only by
-- public.fn_audit, which is security definer, and only from inside a mutating
-- RPC in the same transaction as the change it records.
--
-- Partitioned by month once it passes ~5M rows; not worth the complexity before.
create table public.audit_log (
  id          bigserial primary key,
  org_id      uuid not null,
  actor_id    uuid,
  actor_role  public.app_role,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,   -- 'insert','update','delete','transition','impersonate'
  before      jsonb,
  after       jsonb,
  ip          inet,
  created_at  timestamptz not null default now()
);

create index idx_audit_entity on public.audit_log (entity_type, entity_id, created_at desc);
create index idx_audit_actor on public.audit_log (actor_id, created_at desc);
create index idx_audit_org on public.audit_log (org_id);

alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

create policy audit_select on public.audit_log for select to authenticated
  using ( org_id = public.auth_org() and public.is_admin() );

-- No insert, update or delete policy for ANY role, including owner.
-- Disputes surface months later; the log has to be worth reading when they do.
