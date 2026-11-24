-- APX-06 — the orphan sweep asks the database about one page of R2 keys at a
-- time, instead of loading "every referenced key" in one unpaged select.
--
-- attachment.orphan_sweep built its keep-list with
-- `supabase.from("attachments").select("r2_key, thumb_r2_key")`. PostgREST
-- caps an unpaged select at 1,000 rows (the project's max-rows), silently, so
-- past 1,000 attachments the keep-list was incomplete and the sweep deleted
-- real photos, drawings and bill PDFs whose rows happened to fall past the
-- cap — progressively, every Sunday.
--
-- This function takes the keys of one ListObjectsV2 page (at most 1,000) and
-- returns the subset some row still references. The caller deletes nothing
-- this function returns. "Referenced" is deliberately broad:
--   * attachments.r2_key and attachments.thumb_r2_key, INCLUDING soft-deleted
--     rows — a soft-deleted attachment is retained evidence (AGENTS.md
--     database rule 7), so its object is retained too;
--   * orgs.logo_r2_key.
-- Any future column that stores an R2 key must be added here, or the sweep
-- will treat its objects as orphans.
--
-- service_role only: it reveals which keys exist across every org.

create index if not exists idx_att_thumb_key
  on public.attachments (thumb_r2_key) where thumb_r2_key is not null;

create or replace function public.rpc_r2_keys_referenced(p_keys text[])
returns setof text
language sql stable security definer
set search_path = ''
as $$
  select k
    from unnest(p_keys) as k
   where exists (select 1 from public.attachments a where a.r2_key = k)
      or exists (select 1 from public.attachments a where a.thumb_r2_key = k)
      or exists (select 1 from public.orgs o where o.logo_r2_key = k);
$$;

revoke execute on function public.rpc_r2_keys_referenced(text[]) from public, anon, authenticated;
grant execute on function public.rpc_r2_keys_referenced(text[]) to service_role;
