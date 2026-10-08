-- daily_updates: an author's edit may change the body, and nothing else
--
-- du_update_author lets the author update their own row for 24 hours:
--
--   using      ( author_id = auth.uid() and created_at > now() - interval '24 hours' )
--   with check ( author_id = auth.uid() )
--
-- That decides WHICH rows, not which COLUMNS. The product's only edit
-- (editDailyUpdate, features/updates/actions.ts) sets `body` and `updated_by`
-- — a typo fix, by design: "the date and package a diary entry is filed under
-- don't get a second chance to change" (EditUpdateDialog.tsx). But the table
-- is writable through PostgREST with the author's own token, so inside the
-- window an author could also rewrite update_date, package_id, project_id
-- (to any project at all — with check does not re-test membership),
-- created_at (resetting their own 24-hour clock), deleted_at, and so on.
-- Daily updates are site-diary evidence behind RA bills; the policy's own
-- comment says nobody should be able to rewrite that history.
--
-- A trigger, not column privileges, because that is this schema's existing
-- way to restrict what an update may change (trg_profiles_privilege_guard
-- compares new to old the same way), and because `authenticated` holds the
-- default table-wide UPDATE grant everywhere else — a column-level grant here
-- would be the only one in the schema.
--
-- The rule is an allow-list, so a column added later is frozen by default:
--
--   body        — the edit itself.
--   updated_by  — the audit field editDailyUpdate sets; only to the caller.
--   updated_at  — set by trg_du_updated_at regardless of what is sent.
--
-- Everything else (id, org_id, project_id, package_id, update_date,
-- author_id, created_at, created_by, deleted_at, ...) must be unchanged.
--
-- Scope, matching the precedent: only a signed-in caller (auth.uid() is not
-- null) is held to it. No auth.uid() means the migration role, the seed or
-- service_role — those bypass RLS entirely already, so there is nothing here
-- for them to gain, and a genuine data correction stays possible.
--
-- Errors: FORBIDDEN:, errcode 42501, as every other refusal in this schema;
-- mapDomainError shows "You don't have permission to do that."
--
-- Preserved: author-only editing and the 24-hour window (du_update_author,
-- unchanged), who may insert (du_insert, unchanged), editDailyUpdate's
-- behaviour (it only ever sends body and updated_by = the caller).
--
-- Not changed: RLS policies, any application code.

create or replace function public.trg_daily_updates_body_only_edit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    return new;
  end if;

  if (to_jsonb(new) - 'body' - 'updated_by' - 'updated_at')
     is distinct from (to_jsonb(old) - 'body' - 'updated_by' - 'updated_at') then
    raise exception 'FORBIDDEN: only the body of a daily update can be edited'
      using errcode = '42501';
  end if;

  if new.updated_by is distinct from old.updated_by and new.updated_by is distinct from v_actor then
    raise exception 'FORBIDDEN: updated_by must be the editing user'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger trg_daily_updates_body_only
  before update on public.daily_updates
  for each row execute function public.trg_daily_updates_body_only_edit();
