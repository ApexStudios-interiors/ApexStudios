-- Invariants the seed must hold, because Builds 04–09 develop against them.
--
-- docs/build/02-database.md §5.4. A seed that quietly loses its "one complete
-- phase" makes Build 09 look broken for a day before anyone thinks to check the
-- data rather than the code.

begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (select count(distinct status)::int from public.stock_requests),
  5, 'the seed covers all five stock request statuses'
);

select is(
  (select count(distinct status)::int from public.bills where status <> 'cancelled'),
  4, 'the seed covers draft, submitted, certified and paid'
);

select is(
  (select count(distinct status)::int from public.approvals),
  3, 'the seed covers pending, approved and rejected approvals'
);

-- Without at least one fully complete phase, Billable Now is empty and Build 09
-- has nothing to develop against.
select cmp_ok(
  (select count(*)::int from public.v_phase_billing where is_complete),
  '>=', 1, 'at least one phase is complete, so Billable Now is non-empty'
);

select is(
  (select count(distinct
     case when qty_on_hand = 0 then 'critical'
          when qty_on_hand < reorder_level then 'low'
          else 'ok' end)::int
     from public.inventory_items),
  3, 'inventory covers all three derived stock states'
);

-- The org legal identity check does NOT live here, deliberately. It is a real
-- gate — Build 02 §0 asks for it, and it prints on every tax invoice — but it
-- is Voola's decision on hold (docs/decisions.md), not a code defect. Putting
-- it in this suite would make the BLOCKING pgTAP stage red for a business
-- reason it cannot fix, which is exactly the "permanently red required check
-- that people learn to ignore" failure mode `pnpm check:release` exists to
-- avoid. It is asserted there instead, as a soft, informational CI job.

-- next_bill_seq must lead the seeded bills or the first real rpc_create_bill
-- collides on bills_seq_uq.
select is_empty(
  $$ select p.code::text from public.projects p
      where p.next_bill_seq <= (
        select coalesce(max(b.seq_no), 0) from public.bills b where b.project_id = p.id
      ) $$,
  'next_bill_seq leads the highest seeded bill on every project'
);

-- Units are a closed vocabulary confirmed by Voola on 2026-09-10. Both
-- inventory_items and stock_requests reference them, so losing one breaks
-- inserts rather than degrading gracefully.
select set_eq(
  $$ select code::text from public.units $$,
  $$ values ('bag'),('sft'),('kit'),('len'),('can'),('sqm'),('rft'),('nos'),('set') $$,
  'the unit vocabulary is exactly the nine confirmed codes'
);

select is_empty(
  $$ select i.name::text from public.inventory_items i
      left join public.units u on u.code = i.unit
     where u.code is null $$,
  'every seeded inventory item uses a unit from the vocabulary'
);

select * from finish();
rollback;
