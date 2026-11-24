# Runbook: inventory drift detected

**Trigger.** An `inventory.reconcile` row on **Ops → Failed Jobs** whose error starts
`DRIFT_DETECTED: N inventory item(s) disagree with their own ledger`. The Vercel log for that
run has one line per item: `inventory.reconcile: drift on "<name>" (<item id>) — cache=X,
ledger=Y`. (Since APX-23 the job retries itself for about half an hour before it shows as
failed, so a drift that persists through every retry is real.)

**What it means.** `inventory_items.qty_on_hand` is a cache. The truth is the append-only
`stock_movements` ledger (AGENTS.md database rule 6). Drift means something changed the cache
without writing a movement, or wrote a movement without changing the cache — a code path that
bypassed the stock RPCs, or a manual SQL edit. The job deliberately does **not** correct the
cache: overwriting it would erase the only evidence of the bug (build/07 §5).

**Severity: P2.** Stock figures on screen are wrong for the listed items until fixed.

---

## 1. See the drift

In the Supabase SQL editor (`rpc_inventory_drift` is service_role-only; the editor runs as a
privileged role). Read-only queries only in this step:

```sql
select * from public.rpc_inventory_drift();
```

For one item, the cache against the ledger, with the same formula the job uses (`adjust`
corrections are recorded as `in` or `out`, D31):

```sql
select i.name, i.qty_on_hand as cached,
       coalesce(sum(case m.direction when 'in' then m.qty when 'out' then -m.qty else 0 end), 0) as ledger
  from public.inventory_items i
  left join public.stock_movements m on m.inventory_item_id = i.id
 where i.id = '<item id>'
 group by i.id, i.name, i.qty_on_hand;
```

`drift = cached − ledger`.

## 2. Find the un-ledgered write

1. `audit_log` for the item, newest first:

   ```sql
   select created_at, actor_id, action,
          before ->> 'qty_on_hand' as before_qty, after ->> 'qty_on_hand' as after_qty
     from public.audit_log
    where entity_type = 'inventory_item' and entity_id = '<item id>'
    order by created_at desc limit 50;
   ```

   Compare with the item's movements (`select * from public.stock_movements where
   inventory_item_id = '<item id>' order by created_at desc`). A cache change with no movement
   at the same moment (or the reverse) is the culprit.
2. No audit row either? The write came from outside the RPCs (a direct `update`, a script, the
   SQL editor). Check recent deploys and who ran SQL.
3. Fix that code path so it goes through `rpc_adjust_inventory` / `rpc_transition_stock_request`
   (AGENTS.md database rule 4) **before** correcting anything, or the drift will come back.

## 3. Correct it with a compensating movement

Never `update inventory_items set qty_on_hand = …`, and never edit or delete a movement.

Note that the in-app **Adjust** (`rpc_adjust_inventory`) changes the cache and writes a movement
of the same size, so it **preserves** an existing drift — it cannot close one on its own. Close
the gap in the ledger first, then use Adjust if the physical count differs.

1. **Make the ledger agree with the cache** with one compensating row (append-only insert, in
   the SQL editor), carrying a reason that names this runbook and the date. For `drift > 0`
   (cache above ledger) the row is `in`; for `drift < 0` it is `out`; `qty` is `abs(drift)`:

   ```sql
   insert into public.stock_movements (org_id, inventory_item_id, project_id, direction, qty, ref_type, reason)
   select i.org_id, i.id, i.project_id, 'in', 5, 'adjustment',
          'Reconcile drift 2026-11-24 (inventory-drift.md): ledger missing a receipt of 5, see <ticket>'
     from public.inventory_items i where i.id = '<item id>';
   ```

2. **If the physical stock differs from the cache**, count it and, as an admin in the app, open
   **Inventory → the item → Adjust** and set the counted quantity with a reason. That writes the
   `adjust` movement and the audit row in one transaction, and leaves cache and ledger equal.

## 4. Confirm

1. `select * from public.rpc_inventory_drift();` no longer lists the item.
2. **Ops → Failed Jobs → Retry** the `inventory.reconcile` row. It should succeed.
3. Record the drift, its cause and the fix in `docs/decisions.md` if a code path was at fault.
