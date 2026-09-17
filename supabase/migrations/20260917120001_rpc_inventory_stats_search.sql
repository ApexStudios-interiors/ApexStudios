-- rpc_inventory_stats: accept the Inventory page's `q` search
--
-- The Inventory page's table narrows by `q` (item name or category), but its
-- stat tiles came from this RPC, which only took a project — so searching
-- "tiles" still showed totals for the whole inventory. The totals stay in SQL
-- (build/07-stock-inventory-notifications.md §2.3: never a TypeScript sum over
-- a page); the RPC gains the same filter instead.
--
-- p_search matches EXACTLY what features/inventory/service.ts's
-- `inventorySearchFilter` sends to PostgREST for the table
-- (`name.ilike."%term%",category.ilike."%term%"`):
--   1. `*` is dropped (PostgREST would rewrite it to `%`; the app drops it),
--   2. `\`, `%` and `_` are escaped with a backslash, backslash first,
--   3. the result is wrapped in `%…%` and matched case-insensitively against
--      name OR category (a null category simply does not match, as in the
--      table's own `or=` filter).
-- Postgres' default LIKE escape character is already `\`; it is stated
-- explicitly below so the equivalence does not rest on a default. Trimming
-- and the 80-character cap happen once, in `normalizeInventorySearch`, before
-- the same string reaches both the table query and this RPC. A null p_search
-- is no filter at all, which is what every existing caller gets.
--
-- Why DROP first rather than a bare `create or replace`: adding a parameter
-- changes the identity signature, so `create or replace` alone would leave the
-- old rpc_inventory_stats(uuid) in place as a second overload. With both
-- overloads defaulting their arguments, a call with only p_project_id (or no
-- arguments — tests/integration/stock-and-inventory.test.ts makes one) becomes
-- ambiguous and PostgREST refuses it (PGRST203). Dropping and recreating in
-- this one transaction leaves exactly one function, and every existing call
-- shape — no args, or p_project_id alone — resolves to it unchanged.
--
-- Everything else is carried over verbatim from
-- 20260914090003_rpc_inventory_stats_admin_only_value.sql (D40):
-- `security invoker`, `set search_path = ''`, `stable`, the four output
-- columns and their types, the admin-only `total_value` case expression, the
-- low/critical filters, `deleted_at is null`, the project filter, and the
-- comment. The drop discards the old function's ACL, so the original grants
-- from 20260913090003_rpc_inventory_stats.sql are re-applied: no PUBLIC, no
-- anon, execute for authenticated.
drop function if exists public.rpc_inventory_stats(uuid);

create or replace function public.rpc_inventory_stats(
  p_project_id uuid default null,
  p_search     text default null
)
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
  with pattern as (
    select '%' || replace(replace(replace(replace(p_search, '*', ''), '\', '\\'), '%', '\%'), '_', '\_') || '%' as p
  )
  select
    count(*),
    case when public.is_admin() then coalesce(sum(i.qty_on_hand * i.unit_cost), 0) else null end,
    count(*) filter (where i.qty_on_hand > 0 and i.qty_on_hand < i.reorder_level),
    count(*) filter (where i.qty_on_hand = 0)
  from public.inventory_items i
  cross join pattern
  where i.deleted_at is null
    and (p_project_id is null or i.project_id = p_project_id)
    and (
      p_search is null
      or i.name ilike pattern.p escape '\'
      or i.category ilike pattern.p escape '\'
    );
$$;

revoke execute on function public.rpc_inventory_stats(uuid, text) from public, anon;
grant execute on function public.rpc_inventory_stats(uuid, text) to authenticated;

comment on function public.rpc_inventory_stats(uuid, text) is
  'total_value is null for a non-admin caller, computed in the RPC itself (D40) — not merely discarded by features/inventory/queries.ts, which still discards it too as a second boundary. p_search matches features/inventory/service.ts inventorySearchFilter exactly (name or category, * dropped, \ % _ escaped).';
