-- 0040 — notification_reads: per-user read state for the bell
--
-- REVERSES part of ADR-014 ("no notification table, no read state") and D56
-- ("leave the behaviour as it is"), by owner decision on 2026-09-28 after a
-- second test round reported the same thing again: opening a notification
-- left the badge at 9, which reads as broken however it is documented.
--
-- What is NOT reversed: there is still no notifications table. `v_notifications`
-- remains computed live, so a row still exists exactly as long as the thing
-- needing attention exists. This table stores only the fact that a given user
-- has SEEN a given notification — it never creates, holds or outlives one.
-- Nothing here can resurrect a notification whose underlying work is done,
-- and an unswept row is inert rather than wrong.
--
-- The badge counts unread; the dropdown still lists everything, read or not.
-- A read item is not finished work, so hiding it would lose the property D56
-- was protecting.
create table public.notification_reads (
  profile_id uuid        not null references public.profiles(id) on delete cascade,
  -- Deliberately NOT a foreign key and NOT an enum. `v_notifications` is a
  -- union over four unrelated tables, so `entity_id` has no single referent
  -- and `kind` is a discriminator the view computes, not a stored domain.
  -- Constraining either would couple this table to the view's current shape
  -- and break the next branch added to it.
  kind       text        not null,
  entity_id  uuid        not null,
  -- Compared against the notification's own created_at rather than merely
  -- existing: that is what makes re-raising work. A stock request that goes
  -- back to pending, or an inventory item that drops below its reorder level
  -- again, carries a NEWER created_at than this read_at and so counts as
  -- unread again — without which a user would silently stop being told about
  -- anything they had once looked at.
  read_at    timestamptz not null default now(),
  primary key (profile_id, kind, entity_id)
);

alter table public.notification_reads enable row level security;
alter table public.notification_reads force row level security;

-- Own rows only, all four verbs. Unlike rate_limits (0031), a session reading
-- or clearing its own read state is legitimate: the worst it can do is make
-- its own badge go back up. There is nothing here worth protecting from its
-- owner, and no other user's row is reachable.
create policy nr_select_own on public.notification_reads
  for select using (profile_id = auth.uid());
create policy nr_insert_own on public.notification_reads
  for insert with check (profile_id = auth.uid());
create policy nr_update_own on public.notification_reads
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy nr_delete_own on public.notification_reads
  for delete using (profile_id = auth.uid());

-- The read path is "every read row for this user", which the primary key's
-- leading column already serves. No second index: the table is bounded by
-- (users x open notifications), which for this business is tens of rows.

comment on table public.notification_reads is
  'Per-user read state for the bell (D60, 2026-09-28). Partially reverses ADR-014: v_notifications is still computed live with no notifications table; this records only that a user has seen one. Unread = no row, or read_at < the notification''s created_at, so re-raised work reappears.';

grant select, insert, update, delete on public.notification_reads to authenticated;
