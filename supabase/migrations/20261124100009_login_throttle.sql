-- Security hardening (audit 2026-11-24, APX-38): a per-username sign-in
-- throttle
--
-- Sign-in runs on the server (features/auth/actions.ts), so Supabase Auth's
-- per-IP limit sees Vercel's addresses: one attacker can exhaust a bucket other
-- users share, and nothing limits guesses against ONE account. Generated
-- 12-character passwords make guessing impractical today; this makes it
-- impossible at any useful rate.
--
-- The rule, decided here and nowhere else (the caller passes only the
-- username — the same lesson as rpc_check_rate_limit, APX-56):
--   10 failed sign-ins for one username within a 15-minute window, and that
--   username is refused until the window ends. A success does not reset it
--   (a reset callable without a password would undo the throttle).
--
-- Keyed by sha256 of the normalised username (trimmed, lower-cased — the same
-- normalisation signInEmail applies), never the username itself: whatever is
-- typed into the box, a password pasted into the wrong field included, is
-- never stored. Usernames that do not exist are counted exactly like real
-- ones, so the throttle reveals nothing about which accounts exist.
--
-- Same shape as rate_limits (20260914090001): RLS forced, NO policy for any
-- role, reached only through the two SECURITY DEFINER functions below. They
-- are executable by anon because sign-in happens before there is a session.
-- Someone could call rpc_login_record_failure directly to lock a username for
-- 15 minutes — exactly what ten wrong passwords on /login already do; the
-- window is short and bounded. Supabase's CAPTCHA and leaked-password
-- protection are dashboard settings, recorded as an owner follow-up.
create table public.login_throttle (
  username_hash text primary key,
  window_start  timestamptz not null default now(),
  failures      int not null default 0
);

create index idx_login_throttle_window on public.login_throttle (window_start);

alter table public.login_throttle enable row level security;
alter table public.login_throttle force row level security;

-- No policy for any role, deliberately (00_structural_test lists it).

create or replace function public.fn_login_key(p_username text)
returns text
language sql immutable
set search_path = ''
as $$ select encode(sha256(convert_to(lower(btrim(coalesce(p_username, ''))), 'UTF8')), 'hex') $$;

revoke execute on function public.fn_login_key(text) from public, anon, authenticated;

create or replace function public.rpc_login_allowed(p_username text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select t.failures < 10
       from public.login_throttle t
      where t.username_hash = public.fn_login_key(p_username)
        and t.window_start > now() - interval '15 minutes'),
    true
  );
$$;

create or replace function public.rpc_login_record_failure(p_username text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- Housekeeping: a row past its window is dead weight. Cheap (indexed) and
  -- keeps the table to roughly the last day's failed usernames.
  delete from public.login_throttle where window_start < now() - interval '1 day';

  insert into public.login_throttle (username_hash, window_start, failures)
  values (public.fn_login_key(p_username), now(), 1)
  on conflict (username_hash) do update
    set window_start = case
          when public.login_throttle.window_start <= now() - interval '15 minutes' then now()
          else public.login_throttle.window_start
        end,
        failures = case
          when public.login_throttle.window_start <= now() - interval '15 minutes' then 1
          else public.login_throttle.failures + 1
        end;
end;
$$;

revoke execute on function public.rpc_login_allowed(text) from public;
revoke execute on function public.rpc_login_record_failure(text) from public;
grant execute on function public.rpc_login_allowed(text) to anon, authenticated;
grant execute on function public.rpc_login_record_failure(text) to anon, authenticated;
