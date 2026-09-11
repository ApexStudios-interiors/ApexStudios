-- 0029 — rpc_inventory_drift
--
-- build/07-stock-inventory-notifications.md §2.4. `inventory.reconcile`
-- needs "Σ in − Σ out per item, compared against the cache" as one indexed
-- aggregate query, not every stock_movements row pulled into the job
-- handler to sum in JavaScript — this is the whole point of "explain
-- analyze on the business-wide inventory query with 5,000 items: index
-- scans" applying to the reconcile path too, not just the UI's own reads.
--
-- service_role only: the nightly job (lib/jobs/handlers/inventory.reconcile.ts)
-- is its only caller. A real user session has no legitimate reason to run
-- this directly — it isn't money-sensitive, but least privilege is still the
-- default, the same reasoning rpc_claim_jobs/rpc_finish_job already apply.
create or replace function public.rpc_inventory_drift()
returns table (
  item_id    uuid,
  name       text,
  cached_qty numeric,
  ledger_qty numeric
)
language sql security definer
set search_path = ''
stable
as $$
  select
    i.id,
    i.name,
    i.qty_on_hand,
    -- D31 (docs/decisions.md): 'adjust' movements are recorded as 'in' or
    -- 'out' (whichever sign the correction is), so the ledger total is one
    -- formula with nothing structurally different about a correction row.
    coalesce(sum(case when m.direction = 'in' then m.qty when m.direction = 'out' then -m.qty else 0 end), 0)
  from public.inventory_items i
  left join public.stock_movements m on m.inventory_item_id = i.id
  where i.deleted_at is null
  group by i.id, i.name, i.qty_on_hand
  having i.qty_on_hand <> coalesce(sum(case when m.direction = 'in' then m.qty when m.direction = 'out' then -m.qty else 0 end), 0);
$$;

revoke execute on function public.rpc_inventory_drift() from public, anon, authenticated;
grant execute on function public.rpc_inventory_drift() to service_role;
