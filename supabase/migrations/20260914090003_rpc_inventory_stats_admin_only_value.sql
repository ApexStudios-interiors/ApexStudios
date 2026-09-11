-- 0033 — rpc_inventory_stats: never compute total_value for a non-admin caller
--
-- build/07-stock-inventory-notifications.md §2.3, D40 (docs/decisions.md).
-- Found in review: this function always summed `unit_cost` and relied on
-- `features/inventory/queries.ts` to discard `total_value` before a Site
-- session's DTO is built — "the CALLER decides whether to even read the
-- column back" was this migration's own original comment, which is exactly
-- the "hide it in the UI" pattern AGENTS.md says to stop and flag, not the
-- "never fetch it in the first place" one every other admin-only figure in
-- this codebase uses. A Site session calling this RPC directly (its own
-- grant already allows `authenticated`, which Site is) got the real
-- `unit_cost`-derived total regardless of what the app's own UI shows.
--
-- Fixed the same way `rpc_create_stock_request` already strips `rate` for a
-- non-admin caller (migration 20260913090002's own comment: "a security
-- definer function is the real write path regardless of what called it") —
-- here the RPC itself decides whether `total_value` is ever computed, not
-- just whether the DTO layer keeps it. Still `security invoker`: nothing
-- else changes about which ROWS are visible, only whether this one column
-- is ever aggregated for a caller who isn't owner/admin.
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
    case when public.is_admin() then coalesce(sum(i.qty_on_hand * i.unit_cost), 0) else null end,
    count(*) filter (where i.qty_on_hand > 0 and i.qty_on_hand < i.reorder_level),
    count(*) filter (where i.qty_on_hand = 0)
  from public.inventory_items i
  where i.deleted_at is null
    and (p_project_id is null or i.project_id = p_project_id);
$$;

comment on function public.rpc_inventory_stats(uuid) is
  'total_value is null for a non-admin caller, computed in the RPC itself (D40) — not merely discarded by features/inventory/queries.ts, which still discards it too as a second boundary.';
