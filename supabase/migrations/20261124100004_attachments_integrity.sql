-- Security hardening (audit 2026-11-24): what an attachment row may claim
--
-- ── APX-05: the generated invoice is marked, not guessed ─────────────────────
-- getCurrentBillPdfKey picked "the invoice" as the newest PDF on the bill
-- whose file name matched RA-<code>-<n>.pdf. The name is whatever the uploader
-- sent, and any project member — the client included — could upload to a
-- bill. A client uploading "RA-BHEL-NCH-03.pdf" replaced the invoice everyone
-- downloads; uploaded before the bill.pdf job ran, it also made the job's own
-- "already generated?" check find it and skip, so the real invoice was never
-- rendered at all.
--
-- attachments.kind says which rows the SYSTEM wrote: 'generated_invoice' for
-- the bill.pdf job's own document, 'upload' for everything a person sends.
-- A signed-in session can only ever insert 'upload' (att_insert below, and the
-- trigger); the job runs as service_role, which bypasses RLS and has no
-- auth.uid(), and sets 'generated_invoice' itself. The app selects on kind.
--
-- Backfill: an existing row is marked generated only if it looks exactly like
-- the job's output — a PDF on a bill, under that bill's own key prefix, named
-- for one of its revisions, recorded as uploaded by the admin who submitted or
-- created the bill (the job's own uploaded_by rule). An admin's own upload
-- under that exact name would also match; admins are trusted with the invoice
-- regardless. Anyone else's upload stays 'upload' and is never served again.
--
-- ── APX-05 / APX-37: the row must describe its own object ────────────────────
-- att_insert checked membership, uploader and org, but not the KEY: a session
-- could insert a row pointing at any object it had ever learned the key of —
-- a client removed from a project could insert a row (project_id NULL, so no
-- membership test) naming one of that project's photos and keep presigning it
-- through getThumbnailUrl. confirmUploadFor re-derives the key, but only the
-- web/mobile path runs it; PostgREST does not.
--
-- trg_attachments_check_integrity, for a signed-in caller (no auth.uid() —
-- the migration role, seed, service_role job — skips it, as the sibling
-- attachment triggers do):
--   * kind must be 'upload' and thumb_r2_key empty (only the job sets those);
--   * project_id is required, and r2_key must start with exactly
--     org/{org_id}/project/{project_id}/{entity_type}/{entity_id}/ — the
--     layout buildAttachmentKey always produces;
--   * the entity must belong to that project. bill, stock_request and
--     project must already exist; approval and daily_update photos are
--     uploaded BEFORE their row exists (the dialogs choose the id first), so
--     for those a row that does exist must match, and a missing one is left to
--     the existing per-entity triggers (20261007090005, 20261008090002);
--   * a file on a bill may come only from admin or site (02-lld.md §7's "bill
--     copy" rule). A client never uploads to a bill.
-- SECURITY DEFINER because the lookups must see bills / stock_requests whatever
-- the caller's own RLS shows them; it returns no data. Errors use the
-- prefixes mapDomainError already knows.

alter table public.attachments
  add column kind text not null default 'upload';

alter table public.attachments
  add constraint att_kind_ck check (kind in ('upload', 'generated_invoice'));

comment on column public.attachments.kind is
  '''generated_invoice'' only for the bill.pdf job''s own document (service_role); every row a person inserts is ''upload''. getCurrentBillPdfKey serves only generated_invoice. APX-05.';

update public.attachments a
   set kind = 'generated_invoice'
  from public.bills b
 where a.entity_type = 'bill'
   and a.entity_id = b.id
   and a.mime_type = 'application/pdf'
   and a.project_id = b.project_id
   and a.r2_key like 'org/' || b.org_id || '/project/' || b.project_id || '/bill/' || b.id || '/%'
   and (a.file_name = b.bill_no || '.pdf' or a.file_name ~ ('^' || b.bill_no || '-R[0-9]+\.pdf$'))
   and a.uploaded_by in (b.submitted_by, b.created_by)
   and exists (select 1 from public.profiles p where p.id = a.uploaded_by and p.role = 'admin');

-- The policy, with kind pinned. Body otherwise 20260915090006's verbatim.
drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated
  with check (
    (project_id is null or public.is_member_of(project_id))
    and uploaded_by = auth.uid()
    and org_id = public.auth_org()
    and kind = 'upload'
    and (
      entity_type <> 'approval'
      or not exists (
        select 1 from public.approvals a
         where a.id = entity_id and (a.deleted_at is not null or a.status <> 'pending')
      )
    )
  );

create or replace function public.trg_attachments_check_integrity()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    public.app_role;
  v_prefix  text;
  v_project uuid;
begin
  if v_actor is null then
    return new;
  end if;

  if new.kind is distinct from 'upload' or new.thumb_r2_key is not null then
    raise exception 'FORBIDDEN: only the system records a generated file' using errcode = '42501';
  end if;

  if new.project_id is null then
    raise exception 'FORBIDDEN: an uploaded file must belong to a project' using errcode = '42501';
  end if;

  v_prefix := 'org/' || new.org_id || '/project/' || new.project_id || '/'
              || new.entity_type::text || '/' || new.entity_id || '/';
  if left(new.r2_key, length(v_prefix)) <> v_prefix or length(new.r2_key) = length(v_prefix) then
    raise exception 'FORBIDDEN: that key does not belong to this record' using errcode = '42501';
  end if;

  v_role := public.auth_role();

  if new.entity_type = 'bill' then
    -- `is null` spelled out: `null not in (…)` is null, and an `if` on null
    -- does nothing.
    if v_role is null or v_role not in ('admin', 'site') then
      raise exception 'FORBIDDEN: only admin or site may attach a file to a bill' using errcode = '42501';
    end if;
    select b.project_id into v_project from public.bills b
     where b.id = new.entity_id and b.deleted_at is null;
    if not found or v_project is distinct from new.project_id then
      raise exception 'NOT_FOUND: that bill does not exist in this project' using errcode = 'P0002';
    end if;

  elsif new.entity_type = 'stock_request' then
    select sr.project_id into v_project from public.stock_requests sr
     where sr.id = new.entity_id and sr.deleted_at is null;
    if not found or v_project is distinct from new.project_id then
      raise exception 'NOT_FOUND: that stock request does not exist in this project' using errcode = 'P0002';
    end if;

  elsif new.entity_type = 'project' then
    if new.entity_id is distinct from new.project_id then
      raise exception 'NOT_FOUND: that project does not match' using errcode = 'P0002';
    end if;

  elsif new.entity_type = 'approval' then
    select a.project_id into v_project from public.approvals a where a.id = new.entity_id;
    if found and v_project is distinct from new.project_id then
      raise exception 'NOT_FOUND: that approval does not exist in this project' using errcode = 'P0002';
    end if;

  elsif new.entity_type = 'daily_update' then
    select du.project_id into v_project from public.daily_updates du where du.id = new.entity_id;
    if found and v_project is distinct from new.project_id then
      raise exception 'NOT_FOUND: that daily update does not exist in this project' using errcode = 'P0002';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_attachments_integrity
  before insert on public.attachments
  for each row execute function public.trg_attachments_check_integrity();
