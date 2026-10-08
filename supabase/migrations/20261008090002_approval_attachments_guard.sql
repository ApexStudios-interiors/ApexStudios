-- attachments: an approval's sample photos — admin or site only, at most four,
-- race-safe
--
-- The business rule (build/08-approvals.md §2.4, CAN.addSamplePhotos): admin
-- and site add sample photos, at most four per approval, and only while it is
-- pending. Only the "pending" part lived in the database (att_insert's freeze,
-- 0036/0037/0039). The rest was checked in the application, and not where it
-- could hold:
--
--   a. The four-photo cap is counted only in requestUploadFor
--      (features/attachments/upload.ts), when an upload URL is SIGNED — not in
--      confirmUploadFor, which inserts the row. Several URLs signed first
--      (each counting the same, still-unconfirmed total), then all confirmed,
--      insert more than four rows — no concurrency needed. And two concurrent
--      confirms can both pass any count an application makes before its
--      insert: only the database sees both.
--   b. att_insert checks membership, uploader, org and the freeze — not role.
--      A client is a project member, so a client's own token could insert an
--      approval photo straight through PostgREST, though only admin and site
--      may add sample photos.
--
-- The same two gaps 20261007090005 closed for daily-update photos; this is
-- that trigger's rule, for entity_type = 'approval' only:
--
--   * A signed-in caller must be admin or site. (No auth.uid() — the
--     migration role, seed or service_role — skips only this role test, as
--     20261007090005 and trg_profiles_privilege_guard do.)
--   * At most four live photos per approval, counted AFTER a transaction-
--     scoped advisory lock on the approval id: a second insert for the same
--     approval waits until the first commits or rolls back, then counts — so
--     two concurrent confirms cannot both see three. A row lock cannot do
--     this: the create flow uploads photos BEFORE the approval row exists
--     (its id is chosen first — 0037's own comment), so there may be nothing
--     to lock. Different ids hash to different keys and never wait on each
--     other (a collision only serialises two unrelated inserts).
--   * Over the cap: REASON_REQUIRED, errcode 23514, with the same words
--     requestUploadFor already uses ("this approval already has 4
--     attachments"), so mapDomainError shows the same message as today.
--
-- One deliberate difference from 20261007090005: a repeat of an upload that is
-- already recorded (the same r2_key — confirmUploadFor retried after a lost
-- response) is let through to the unique constraint, so confirmUploadFor's own
-- "already recorded" handling still answers it, even for the fourth photo.
-- Without this, retrying the fourth photo's confirm would be refused as a
-- fifth.
--
-- Unchanged: att_insert / att_select / att_delete_uploader (the freeze once
-- decided or deleted, the uploader's own 24-hour delete), every other entity
-- type (the function returns at once), the four-photo limit itself, existing
-- rows (INSERT only — users cannot UPDATE attachments at all), and every
-- application path: the web dialog's upload-then-create flow, addSamplePhotos,
-- and the mobile photo routes all insert as admin or site, at most four.

create or replace function public.trg_attachments_check_approval()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor       uuid := auth.uid();
  v_role        public.app_role;
  v_live_photos int;
begin
  if new.entity_type <> 'approval' then
    return new;
  end if;

  if v_actor is not null then
    v_role := public.auth_role();
    -- `is null` spelled out: `null not in (…)` is null, and an `if` on null
    -- does nothing.
    if v_role is null or v_role not in ('admin', 'site') then
      raise exception 'FORBIDDEN: only admin or site may add sample photos to an approval'
        using errcode = '42501';
    end if;
  end if;

  -- Serialise every photo insert for this approval id until commit.
  perform pg_advisory_xact_lock(hashtextextended('attachments.approval:' || new.entity_id::text, 0));

  -- A retried confirm of an upload already recorded: not a new photo. Let the
  -- attachments_r2_key_key unique constraint answer it, as it always has.
  if exists (select 1 from public.attachments a where a.r2_key = new.r2_key) then
    return new;
  end if;

  select count(*) into v_live_photos
    from public.attachments a
   where a.entity_type = 'approval'
     and a.entity_id = new.entity_id
     and a.deleted_at is null;

  if v_live_photos >= 4 then
    raise exception 'REASON_REQUIRED: this approval already has 4 attachments'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger trg_attachments_approval
  before insert on public.attachments
  for each row execute function public.trg_attachments_check_approval();
