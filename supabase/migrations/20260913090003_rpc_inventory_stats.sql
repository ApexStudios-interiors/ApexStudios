-- 0028 — rpc_inventory_stats
--
-- build/07-stock-inventory-notifications.md §2.3: "The stat row — Total
-- Items, Total Value, Low count, Critical count — is computed in SQL, not
-- by summing a paginated page in TypeScript." PostgREST's query builder has
-- no SUM()/FILTER() of its own, so this is the smallest thing that can do
-- real aggregation without pulling every row to the client first.
--
-- SECURITY INVOKER, not DEFINER: this only ever aggregates rows the caller's
-- own RLS already permits — there's no privileged write and nothing here a
-- session couldn't derive itself from public.inventory_items row by row.
-- total_value is admin-only by construction: it's `unit_cost`, which
-- inventory_items' own select policy already restricts to owner/admin/site,
-- but the CALLER decides whether to even read the column back — this
-- function always computes it, and features/inventory/queries.ts is what
-- discards it before a site session's DTO is built. Never expose this RPC's
-- raw result to a component; go through that query function.
create or replace function public.rpc_inventory_stats(p_project_id uuid default null)
returns table (
  total_items    bigint,
  total_value    numeric,
  low_count      bigint,
  critical_count bigint
)
language sql security invoker
set search_path = ''
stable
as $$
  select
    count(*),
    coalesce(sum(i.qty_on_hand * i.unit_cost), 0),
    count(*) filter (where i.qty_on_hand > 0 and i.qty_on_hand < i.reorder_level),
    count(*) filter (where i.qty_on_hand = 0)
  from public.inventory_items i
  where i.deleted_at is null
    and (p_project_id is null or i.project_id = p_project_id);
$$;

revoke execute on function public.rpc_inventory_stats(uuid) from public, anon;
grant execute on function public.rpc_inventory_stats(uuid) to authenticated;
