-- Security hardening (audit 2026-11-24, APX-34): a stock movement is 'in' or
-- 'out', nothing else
--
-- movement_direction has a third value, 'adjust', from the original schema.
-- qty is always positive and the direction carries the sign (0006), so an
-- 'adjust' row has no sign at all: rpc_inventory_drift counts it as zero, and
-- the ledger would silently disagree with qty_on_hand. D31 already decided
-- that a correction is recorded as 'in' or 'out' (rpc_adjust_inventory does
-- exactly that), and no RPC or seed row writes 'adjust'. This makes the
-- decision a constraint. The enum value itself is left alone — dropping an
-- enum value means rebuilding the type.
--
-- If production held an 'adjust' row this would fail rather than hide it;
-- that is intended (it is the last migration of this set, so everything
-- before it is already applied).
alter table public.stock_movements
  add constraint movements_direction_ck check (direction in ('in', 'out'));
