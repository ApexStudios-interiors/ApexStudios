-- APX-45, APX-66 — package edits no longer report false conflicts, and
-- package/phase numbers are allocated in SQL.
--
-- ── False conflicts (APX-45) ─────────────────────────────────────────────────
-- Edit Package uses packages.updated_at as its optimistic-concurrency token
-- (features/packages/actions.ts: `update … where id = $1 and updated_at = $2`).
-- But the shared trg_set_updated_at (0002) bumps updated_at on EVERY update,
-- including the progress_pct write fn_recompute_progress makes whenever a
-- supervisor moves a task slider. So an admin editing a package while anyone
-- touched a task in it was told someone else had changed it, when nobody had
-- changed anything the form shows.
--
-- packages now has its own BEFORE UPDATE trigger: an update that changes only
-- the trigger-maintained cache (progress_pct) keeps the old updated_at. Every
-- other column change still bumps it, so a real concurrent edit is still
-- caught.
--
-- ── seq_no (APX-45, APX-66) ──────────────────────────────────────────────────
-- createPackage/createPhase read `max(seq_no) + 1` over LIVE rows and then
-- inserted. Two faults: the read-then-write races (two admins adding at once
-- both get N+1 and one hits packages_seq_uq / phases_seq_uq, surfacing as an
-- unmapped "Something went wrong"); and because packages_seq_uq covers
-- soft-deleted rows too, the number of a deleted package was handed out again
-- and ALWAYS collided. The number is now allocated by a BEFORE INSERT trigger,
-- under a lock on the parent row (the project for a package, the package for
-- a phase), over every row including deleted ones. An explicit positive
-- seq_no (the seed, a data repair) is kept as given; 0 / null — the new
-- column default — means "allocate".

-- ── updated_at that ignores the progress cache ───────────────────────────────
create or replace function public.trg_packages_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['progress_pct', 'updated_at', 'updated_by'])
     = (to_jsonb(old) - array['progress_pct', 'updated_at', 'updated_by']) then
    -- Only the trigger-maintained cache moved: not an edit.
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_packages_updated_at on public.packages;
create trigger trg_packages_updated_at before update on public.packages
  for each row execute function public.trg_packages_set_updated_at();

-- The same for phases. Since 20261124600002 the task trigger maintains
-- phases.billing_status on every task write, and Edit Phase (APX-10, the
-- project-setup branch) uses phases.updated_at as its concurrency token too —
-- so without this, moving a task slider would make an admin's phase edit
-- report a conflict, the exact APX-45 failure on the next table down. A
-- billing transition is not an edit of the phase's own fields either: what
-- it must protect (the allocated amount of a billed phase) is guarded by
-- trg_phases_allocated_locked, not by this token.
create or replace function public.trg_phases_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - array['billing_status', 'updated_at', 'updated_by'])
     = (to_jsonb(old) - array['billing_status', 'updated_at', 'updated_by']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_phases_updated_at on public.phases;
create trigger trg_phases_updated_at before update on public.phases
  for each row execute function public.trg_phases_set_updated_at();

-- ── seq_no allocation ────────────────────────────────────────────────────────
-- security definer: the max must see soft-deleted rows, which the admin select
-- policies filter out, and the parent lock must be taken whatever the caller's
-- own grants. `for no key update` serialises concurrent inserts under one
-- parent without conflicting with the FK checks' key-share locks.
create or replace function public.trg_packages_assign_seq()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(new.seq_no, 0) <= 0 then
    perform 1 from public.projects where id = new.project_id for no key update;
    select coalesce(max(pk.seq_no), 0) + 1
      into new.seq_no
      from public.packages pk
     where pk.project_id = new.project_id;
  end if;
  return new;
end;
$$;

create or replace function public.trg_phases_assign_seq()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if coalesce(new.seq_no, 0) <= 0 then
    perform 1 from public.packages where id = new.package_id for no key update;
    select coalesce(max(ph.seq_no), 0) + 1
      into new.seq_no
      from public.phases ph
     where ph.package_id = new.package_id;
  end if;
  return new;
end;
$$;

alter table public.packages alter column seq_no set default 0;
alter table public.phases alter column seq_no set default 0;

create trigger trg_packages_assign_seq before insert on public.packages
  for each row execute function public.trg_packages_assign_seq();
create trigger trg_phases_assign_seq before insert on public.phases
  for each row execute function public.trg_phases_assign_seq();

-- Trigger functions only; nobody calls them directly.
revoke execute on function public.trg_packages_set_updated_at() from public, anon, authenticated;
revoke execute on function public.trg_phases_set_updated_at() from public, anon, authenticated;
revoke execute on function public.trg_packages_assign_seq() from public, anon, authenticated;
revoke execute on function public.trg_phases_assign_seq() from public, anon, authenticated;
