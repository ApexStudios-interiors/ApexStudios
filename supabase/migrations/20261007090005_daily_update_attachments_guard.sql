-- attachments: a daily update's photos belong to that update, its author and
-- its project — at most four, race-safe
--
-- The web posts an update with photos in this order (PostUpdateDialog,
-- FileUploader, features/attachments/actions.ts, features/updates/write.ts):
--
--   1. the dialog picks the update's id up front (crypto.randomUUID());
--   2. per photo: requestUploadUrl → PUT to R2 → confirmUpload, which inserts
--      an `attachments` row tagged (entity_type 'daily_update', entity_id =
--      that id) — BEFORE any daily_updates row exists;
--   3. postDailyUpdate inserts the daily_updates row with that same id, after
--      re-checking each photo is this user's own, for this project and id.
--
-- What nothing checked until now, at the database:
--
--   a. att_insert lets ANY project member insert a row for ANY entity_id —
--      including a client (no role test), and including the id of someone
--      else's posted update, whose photo grid (features/updates/queries.ts
--      fetchAttachments: entity_type + entity_id only) would then show it.
--   b. The four-photo cap is counted only in requestUploadUrl, before the
--      upload. Several URLs requested first, then confirmed, insert more than
--      four rows — and two concurrent confirms can both pass any count.
--
-- So the rule lives on the table, for daily_update rows only. Every other
-- entity type is untouched (the function returns at once).
--
-- ── attachments, before insert, entity_type = 'daily_update' ────────────────
--
--   * A signed-in caller must be admin or site — the roles du_insert lets post
--     an update. A client never could post one; now it cannot attach to one
--     either. (No auth.uid() — the migration role, seed or service_role —
--     skips only this role test, as trg_profiles_privilege_guard does.)
--   * project_id must be set.
--   * If the update is already posted: it must be in this project and not
--     deleted (else NOT_FOUND, as the ancestry triggers say), and its author
--     must be the uploader (else FORBIDDEN).
--   * If it is not posted yet (step 2 above — a legitimate draft id): any photo
--     already on that id must be this uploader's, in this project (else
--     FORBIDDEN) — nobody can add to another user's draft.
--   * At most four live photos per update (else REASON_REQUIRED, the same
--     code and words requestUploadUrl already uses).
--
-- Race safety: the checks and the count run after a transaction-scoped
-- advisory lock on the update id. A second insert for the same id waits until
-- the first commits or rolls back, and only then counts — so two concurrent
-- confirms cannot both see three. A row lock cannot do this: at step 2 there
-- is no daily_updates row to lock yet. Different ids hash to different keys
-- and never wait on each other (a hash collision only serialises two
-- unrelated inserts; it never wrongly refuses one).
--
-- ── daily_updates, before insert ────────────────────────────────────────────
--
--   The other half of the draft rule: an update cannot be posted onto an id
--   whose existing photos were uploaded by someone else or in another project
--   (FORBIDDEN). It takes the same lock, so a photo insert and a post for the
--   same id cannot interleave.
--
-- SECURITY DEFINER, search_path '', as the ancestry triggers: the lookups
-- must see every row for the id, whatever the caller's RLS shows them. The
-- functions only read to validate the write; they return no data.
--
-- Existing rows are not touched: both triggers fire on INSERT only. Users
-- cannot UPDATE attachments at all (no update policy); deleteAttachment's
-- hard delete frees a slot exactly as before.
--
-- Not changed: att_insert / att_select / att_delete_uploader, du_insert, the
-- four-photo limit, any other entity type, any application code.

create or replace function public.trg_attachments_check_daily_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_role         public.app_role;
  v_project_id   uuid;
  v_author_id    uuid;
  v_deleted_at   timestamptz;
  v_live_photos  int;
begin
  if new.entity_type <> 'daily_update' then
    return new;
  end if;

  if v_actor is not null then
    v_role := public.auth_role();
    -- `is null` spelled out: `null not in (…)` is null, and an `if` on null
    -- does nothing.
    if v_role is null or v_role not in ('admin', 'site') then
      raise exception 'FORBIDDEN: only admin or site may add photos to a daily update'
        using errcode = '42501';
    end if;
  end if;

  if new.project_id is null then
    raise exception 'NOT_FOUND: daily update % does not exist in this project', new.entity_id
      using errcode = 'P0002';
  end if;

  -- Serialise every write for this update id until commit (see header).
  perform pg_advisory_xact_lock(hashtextextended('attachments.daily_update:' || new.entity_id::text, 0));

  select du.project_id, du.author_id, du.deleted_at
    into v_project_id, v_author_id, v_deleted_at
    from public.daily_updates du where du.id = new.entity_id;

  if found then
    if v_project_id <> new.project_id or v_deleted_at is not null then
      raise exception 'NOT_FOUND: daily update % does not exist in this project', new.entity_id
        using errcode = 'P0002';
    end if;
    if v_author_id <> new.uploaded_by then
      raise exception 'FORBIDDEN: only the author can add photos to a daily update'
        using errcode = '42501';
    end if;
  elsif exists (
    select 1 from public.attachments a
     where a.entity_type = 'daily_update'
       and a.entity_id = new.entity_id
       and a.deleted_at is null
       and (a.uploaded_by <> new.uploaded_by or a.project_id is distinct from new.project_id)
  ) then
    raise exception 'FORBIDDEN: those photos belong to another daily update'
      using errcode = '42501';
  end if;

  select count(*) into v_live_photos
    from public.attachments a
   where a.entity_type = 'daily_update'
     and a.entity_id = new.entity_id
     and a.deleted_at is null;

  if v_live_photos >= 4 then
    raise exception 'REASON_REQUIRED: this daily_update already has 4 attachments'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_attachments_daily_update
  before insert on public.attachments
  for each row execute function public.trg_attachments_check_daily_update();

create or replace function public.trg_daily_updates_check_photos()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('attachments.daily_update:' || new.id::text, 0));

  if exists (
    select 1 from public.attachments a
     where a.entity_type = 'daily_update'
       and a.entity_id = new.id
       and a.deleted_at is null
       and (a.uploaded_by <> new.author_id or a.project_id is distinct from new.project_id)
  ) then
    raise exception 'FORBIDDEN: those photos belong to another daily update'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_daily_updates_photos
  before insert on public.daily_updates
  for each row execute function public.trg_daily_updates_check_photos();
