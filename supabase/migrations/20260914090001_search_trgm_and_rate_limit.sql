-- 0031 — pg_trgm search indexes, rpc_check_rate_limit
--
-- build/07-stock-inventory-notifications.md §2.7. `searchAll` runs one
-- `ilike` query per entity per keystroke (debounced client-side, but still
-- seven queries a click can trigger) — a sequential scan over `packages` or
-- `stock_requests` at any real data size is the thing this migration exists
-- to prevent. Full-text search (`tsvector`) is not warranted: these are short
-- names and codes, not documents, and `pg_trgm` gives substring matching
-- (`ilike '%marble%'`, not just prefix) with an index behind it.
-- `with schema extensions` (matching 0001's own pgcrypto) keeps pg_trgm's own
-- operator/support functions out of `public` — otherwise scripts/gen-types.mjs
-- picks them up as if they were application RPCs (confirmed live: it does).
create extension if not exists pg_trgm with schema extensions;

create index if not exists idx_projects_name_trgm on public.projects using gin (name gin_trgm_ops);
create index if not exists idx_packages_name_trgm on public.packages using gin (name gin_trgm_ops);
create index if not exists idx_sr_material_name_trgm on public.stock_requests using gin (material_name gin_trgm_ops);
create index if not exists idx_approvals_item_trgm on public.approvals using gin (item gin_trgm_ops);
create index if not exists idx_bills_bill_no_trgm on public.bills using gin (bill_no gin_trgm_ops);
create index if not exists idx_inventory_items_name_trgm on public.inventory_items using gin (name gin_trgm_ops);
create index if not exists idx_profiles_full_name_trgm on public.profiles using gin (full_name gin_trgm_ops);

-- ── Rate limiting ─────────────────────────────────────────────────────────────
-- build §2.7: "Rate-limit it. It is an unauthenticated-feeling input that runs
-- seven queries." No Redis/Upstash exists in this stack (architecture.md's own
-- topology is Vercel + Supabase only), so this is a plain locked-row counter —
-- the same concurrency primitive as `next_sr_seq`/`next_bill_seq`, sized for a
-- per-minute sliding window instead of a monotonic sequence. One row per
-- (profile, action); reset when the window has elapsed rather than accumulated
-- forever.
create table public.rate_limits (
  profile_id   uuid not null references public.profiles(id),
  action       text not null,
  window_start timestamptz not null default now(),
  count        int not null default 0,
  primary key (profile_id, action)
);

alter table public.rate_limits enable row level security;
alter table public.rate_limits force row level security;

-- No policy for any role: the table is reached only through
-- rpc_check_rate_limit (security definer). A session has no legitimate
-- reason to read or write its own throttle counter directly — that would
-- just be a second way to reset it.

-- Returns true if the call is allowed (and records it), false if the caller
-- is over the limit for the current window. `security definer` because the
-- table above has no select/insert/update policy for anyone.
create or replace function public.rpc_check_rate_limit(
  p_action        text,
  p_max_per_window int,
  p_window_seconds int default 60
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.rate_limits;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: no authenticated user' using errcode = '42501';
  end if;

  insert into public.rate_limits (profile_id, action, window_start, count)
  values (v_uid, p_action, now(), 1)
  on conflict (profile_id, action) do update
    set window_start = case
          when public.rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
            then now()
          else public.rate_limits.window_start
        end,
        count = case
          when public.rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
            then 1
          else public.rate_limits.count + 1
        end
  returning * into v_row;

  return v_row.count <= p_max_per_window;
end;
$$;

revoke execute on function public.rpc_check_rate_limit(text, int, int) from public, anon;
grant execute on function public.rpc_check_rate_limit(text, int, int) to authenticated;
