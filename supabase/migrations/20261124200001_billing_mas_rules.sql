-- Billing correctness: material-at-site (MAS) double billing, one definition
-- for preview and bill, ₹0 material lines, IST bill date, billing period,
-- duplicate selections. Audit items APX-07, APX-14 (billing part), APX-22,
-- APX-30, APX-31, APX-60. Decision D69 in docs/decisions.md.
--
-- ── The problem (APX-07) ─────────────────────────────────────────────────────
-- A delivered material is billed as a 75% advance (HLD §8.4 step B). When its
-- phase is later billed in full (step A) the advance is recovered (step D), so
-- the client is not charged twice. Recovery only ever saw material on a
-- committed (non-draft) bill and tied to a phase, so four orderings
-- over-invoiced:
--
--   1. Same bill: the material and its phase both ticked (Billable Now ticked
--      everything by default). Material billed, nothing recovered.
--   2. Material on a DRAFT bill A, then its phase billed on bill B (no
--      recovery, A is a draft), then A submitted. Billed twice.
--   3. Phase billed first, material for that phase delivered later. The
--      material appeared in Billable Now and was billed as a fresh advance on
--      work already invoiced in full.
--   4. Package-level material (phase_id null). Billed as an advance, never
--      recovered, because recovery matches on phase.
--
-- ── The rules (conservative: none of them can over-invoice) ─────────────────
--   R1  A material is billable only while its phase is still unbilled. Once the
--       phase is on any bill (draft included), the phase's value already
--       covers the material, so it leaves Billable Now. [ordering 3]
--   R2  A material and its own phase cannot go on the same bill
--       (MAS_SAME_BILL). The phase's value already includes it. [ordering 1]
--   R3  A phase cannot be billed while one of its materials sits on a draft
--       bill (MAS_DRAFT_PENDING): submit that draft (its advance is then
--       recovered) or cancel it (the material returns, and R1 then hides it
--       once the phase is billed). [ordering 2]
--   R4  Package-level material (no phase) is not billed as an advance at all.
--       There is no phase to recover it against, so the only safe treatment
--       is to let it be paid for when the package's phases are billed.
--       Flagged for CA review: whether and how to advance it. [ordering 4]
--   R5  Recovery larger than the bill's gross is refused (MAS_EXCEEDS_GROSS)
--       instead of flooring taxable at 0 and silently losing the remainder
--       (APX-31). Whether a remainder should carry forward or be credited is a
--       CA question; refusing is the only answer that never issues a bill whose
--       own lines do not add up.
--   R6  A delivered material with no rate (null or 0) is not billable
--       (APX-14): a ₹0 line would mark the material billed for nothing, and it
--       could never be billed at its real value afterwards.
--
-- ── One definition (APX-30) ──────────────────────────────────────────────────
-- v_billable_now now carries, per phase row, `mas_recovery` (the advance to
-- recover, from committed bills only) and `blocked_by_bill_no` (a draft
-- holding one of its materials), and per material row its `phase_id`. Both
-- rpc_create_bill and the Billable Now preview (features/billing/service.ts)
-- read these columns, so the preview is the bill.
--
-- ── Also here ────────────────────────────────────────────────────────────────
--   * Material `amount` is computed from the ROUNDED client value (APX-60), so
--     client_value × pct / 100 reconciles to the paisa on the bill line.
--   * Duplicate entries in p_lines are de-duplicated rather than reported as
--     ALREADY_BILLED (APX-60).
--   * p_bill_date defaults to today in Asia/Kolkata, not the database's UTC
--     current_date (APX-22). The app always passes it; this is the backstop.
--     The date is re-set at submission (20261124200002).
--   * p_period_from / p_period_to: the optional billing period, both or
--     neither, from <= to (INVALID_PERIOD).
--
-- Never edit an applied migration: the view is replaced and the function
-- dropped and recreated here. Its signature gains two parameters, and a
-- `create or replace` with a different argument list would add an overload
-- instead, leaving PostgREST to pick between two functions.

create or replace view public.v_billable_now
with (security_invoker = on) as
-- Completed phases not yet on a bill.
select
  ph.project_id,
  'phase'::public.bill_line_source as source_type,
  ph.id                            as source_id,
  pk.name || ' — ' || ph.name      as description,
  ph.allocated_amount              as client_value,
  100::numeric(6,3)                as pct_billed,
  ph.allocated_amount              as amount,
  ph.internal_amount               as internal_cost,
  ph.id                            as phase_id,
  m.mas_recovery                   as mas_recovery,
  m.blocked_by_bill_no             as blocked_by_bill_no
from public.phases ph
join public.packages pk on pk.id = ph.package_id
join public.v_phase_billing vb on vb.phase_id = ph.id
-- The material advanced against THIS phase. Only a committed bill's lines
-- count toward recovery: a draft may still be cancelled, and a cancelled
-- bill's lines are already deleted. A draft holding one of this phase's
-- materials blocks the phase instead (R3).
cross join lateral (
  select
    coalesce(sum(bl.amount) filter (where b.status <> 'draft'), 0)::numeric(14,2) as mas_recovery,
    min(b.bill_no) filter (where b.status = 'draft')                             as blocked_by_bill_no
  from public.bill_lines bl
  join public.stock_requests sr on sr.id = bl.source_id
  join public.bills b on b.id = bl.bill_id
  where bl.source_type = 'material' and sr.phase_id = ph.id
) m
where ph.deleted_at is null
  and vb.is_complete
  and ph.billing_status in ('unresolved', 'billable')
  and not exists (
    select 1 from public.bill_lines bl
     where bl.source_type = 'phase' and bl.source_id = ph.id
  )

union all

-- Delivered materials not yet billed, at mas_billable_pct as a secured advance
-- (D4, pending CA confirmation) — only while their phase is unbilled (R1),
-- only when tied to a phase (R4) and only with a rate (R6).
select
  sr.project_id,
  'material'::public.bill_line_source,
  sr.id,
  sr.material_name || ' (' || sr.qty || ' ' || sr.unit || ')',
  cv.client_value,
  pr.mas_billable_pct,
  round(cv.client_value * pr.mas_billable_pct / 100, 2),
  round(sr.qty * sr.rate, 2),
  sr.phase_id,
  0::numeric(14,2),
  null::text
from public.stock_requests sr
join public.projects pr on pr.id = sr.project_id
join public.phases ph on ph.id = sr.phase_id and ph.deleted_at is null
cross join lateral (
  select public.fn_cost_to_client_factor(sr.phase_id, sr.package_id) as factor
) f
cross join lateral (
  select round(sr.qty * sr.rate * f.factor, 2) as client_value
) cv
where sr.deleted_at is null
  and sr.status = 'delivered'
  and sr.billed_on_bill_id is null
  and sr.rate is not null
  and sr.rate > 0
  and ph.billing_status in ('unresolved', 'billable')
  and not exists (
    select 1 from public.bill_lines bl
     where bl.source_type = 'phase' and bl.source_id = sr.phase_id
  );

comment on view public.v_billable_now is
  'Admin-only. Carries internal_cost. Feeds the Billable Now table, its preview and rpc_create_bill — one definition for all three (APX-30). Phase rows carry mas_recovery (material advance on committed bills to recover) and blocked_by_bill_no (a draft holding one of its materials, R3); material rows carry phase_id and appear only while that phase is unbilled (R1), only when tied to a phase (R4) and only with a positive rate (R6). See migration 20261124200001 and D69. The `not exists` on bill_lines is a second guard behind idx_bill_lines_source.';

drop function if exists public.rpc_create_bill(uuid, jsonb, date, text, text);

create function public.rpc_create_bill(
  p_project_id      uuid,
  p_lines           jsonb,                  -- [{source_type, source_id}, ...]
  p_bill_date       date default null,      -- null: today in Asia/Kolkata
  p_notes           text default null,
  p_idempotency_key text default null,
  p_period_from     date default null,
  p_period_to       date default null
) returns public.bills
language plpgsql security definer
set search_path = ''
as $$
declare
  v_project           public.projects%rowtype;
  v_existing          public.bills;
  v_bill              public.bills;
  v_bill_date         date;
  v_work_value        numeric(14,2);
  v_material_value    numeric(14,2);
  v_gross             numeric(14,2);
  v_mas_recovery      numeric(14,2);
  v_taxable           numeric(14,2);
  v_gst               numeric(14,2);
  v_invoice_total     numeric(14,2);
  v_retention         numeric(14,2);
  v_tds               numeric(14,2);
  v_advance_recovery  numeric(14,2);
  v_net_payable       numeric(14,2);
  v_internal_cost     numeric(14,2);
  v_margin            numeric(14,2);
  v_requested         int;
  v_line_count        int;
  v_same_bill         int;
  v_blocked_by        text;
  v_phase_ids         uuid[];
  v_material_ids      uuid[];
  v_seq               int;
  v_bill_no           text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: rpc_create_bill is admin-only' using errcode = '42501';
  end if;
  if not public.is_member_of(p_project_id) then
    raise exception 'FORBIDDEN: not a member of project %', p_project_id using errcode = '42501';
  end if;

  -- Row lock FIRST: it serialises next_bill_seq into gapless RA numbers (T-03),
  -- makes the idempotency check race-free, and serialises every rule below
  -- against a concurrent bill on the same project.
  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'NOT_FOUND: project % does not exist', p_project_id using errcode = 'P0002';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.bills
     where project_id = p_project_id and idempotency_key = p_idempotency_key and deleted_at is null;
    if found then
      return v_existing; -- a double-clicked Create Bill returns the one bill, not a second one
    end if;
  end if;

  if (p_period_from is null) <> (p_period_to is null) or p_period_from > p_period_to then
    raise exception 'INVALID_PERIOD: give both period dates, with the start on or before the end'
      using errcode = '23514';
  end if;

  v_bill_date := coalesce(p_bill_date, (now() at time zone 'Asia/Kolkata')::date);

  -- The selection, de-duplicated (APX-60): the same item ticked twice is one
  -- item, not a reason to report ALREADY_BILLED.
  select
    count(*),
    coalesce(array_agg(s.source_id) filter (where s.source_type = 'phase'), '{}'),
    coalesce(array_agg(s.source_id) filter (where s.source_type = 'material'), '{}')
    into v_requested, v_phase_ids, v_material_ids
    from (
      select distinct sel.source_type, sel.source_id
        from jsonb_to_recordset(p_lines) as sel(source_type public.bill_line_source, source_id uuid)
    ) s;

  select
    coalesce(sum(bn.amount) filter (where bn.source_type = 'phase'), 0),
    coalesce(sum(bn.amount) filter (where bn.source_type = 'material'), 0),
    coalesce(sum(bn.mas_recovery) filter (where bn.source_type = 'phase'), 0),
    coalesce(sum(bn.internal_cost), 0),
    count(*),
    count(*) filter (where bn.source_type = 'material' and bn.phase_id = any(v_phase_ids)),
    min(bn.blocked_by_bill_no) filter (where bn.source_type = 'phase')
    into v_work_value, v_material_value, v_mas_recovery, v_internal_cost,
         v_line_count, v_same_bill, v_blocked_by
    from public.v_billable_now bn
   where bn.project_id = p_project_id
     and (   (bn.source_type = 'phase'    and bn.source_id = any(v_phase_ids))
          or (bn.source_type = 'material' and bn.source_id = any(v_material_ids)));

  if v_line_count = 0 then
    raise exception 'NOTHING_SELECTED: no billable lines matched the selection' using errcode = '23514';
  end if;
  if v_line_count <> v_requested then
    -- A selected item no longer resolves against v_billable_now: billed by
    -- someone else since the page loaded, or no longer billable under R1/R4/R6.
    raise exception 'ALREADY_BILLED: one or more selected items are no longer billable' using errcode = '23514';
  end if;
  if v_same_bill > 0 then
    raise exception 'MAS_SAME_BILL: a material and its own phase cannot be billed together — the phase already includes it'
      using errcode = '23514';
  end if;
  if v_blocked_by is not null then
    raise exception 'MAS_DRAFT_PENDING: material for a selected phase is on draft bill % — submit or cancel it first', v_blocked_by
      using errcode = '23514';
  end if;

  v_gross := v_work_value + v_material_value;

  if v_mas_recovery > v_gross then
    raise exception 'MAS_EXCEEDS_GROSS: material advance to recover (%) exceeds this bill''s gross (%)', v_mas_recovery, v_gross
      using errcode = '23514';
  end if;

  -- HLD §8.4, fixed order. GST on taxable, BEFORE retention.
  v_taxable       := v_gross - v_mas_recovery;
  v_gst           := round(v_taxable * v_project.gst_rate_pct / 100, 2);
  v_invoice_total := v_taxable + v_gst;
  v_retention     := round(v_taxable * v_project.retention_pct / 100, 2);
  v_tds           := round(v_taxable * v_project.tds_pct / 100, 2);
  v_advance_recovery := least(
    greatest(v_project.mobilisation_advance - v_project.mobilisation_recovered, 0),
    round(v_taxable * v_project.mobilisation_recovery_pct / 100, 2)
  );
  v_net_payable := v_invoice_total - v_retention - v_tds - v_advance_recovery;
  v_margin      := v_taxable - v_internal_cost;

  v_seq := v_project.next_bill_seq;
  -- Zero-pad below 10 only; never lpad (it truncates 3+ digits — 0045).
  v_bill_no := 'RA-' || v_project.code || '-' ||
    case when v_seq < 10 then '0' || v_seq::text else v_seq::text end;
  update public.projects
     set next_bill_seq = next_bill_seq + 1,
         mobilisation_recovered = mobilisation_recovered + v_advance_recovery
   where id = p_project_id;

  -- Rates snapshotted from the project NOW, at creation (ADR-006).
  insert into public.bills (
    org_id, project_id, seq_no, bill_no, bill_date, period_from, period_to, notes,
    work_value, material_value, gross_amount, mas_recovery_amount,
    taxable_amount, gst_amount, invoice_total, retention_amount, tds_amount,
    advance_recovery, net_payable, internal_cost_amount, margin_amount,
    gst_rate_pct, retention_pct, tds_pct, idempotency_key, created_by
  ) values (
    v_project.org_id, p_project_id, v_seq, v_bill_no, v_bill_date, p_period_from, p_period_to, p_notes,
    v_work_value, v_material_value, v_gross, v_mas_recovery,
    v_taxable, v_gst, v_invoice_total, v_retention, v_tds,
    v_advance_recovery, v_net_payable, v_internal_cost, v_margin,
    v_project.gst_rate_pct, v_project.retention_pct, v_project.tds_pct, p_idempotency_key, auth.uid()
  ) returning * into v_bill;

  insert into public.bill_lines (
    bill_id, source_type, source_id, description, client_value, pct_billed, amount, internal_cost, sort_order
  )
  select v_bill.id, bn.source_type, bn.source_id, bn.description, bn.client_value, bn.pct_billed, bn.amount,
         bn.internal_cost, row_number() over (order by bn.source_type, bn.description)
    from public.v_billable_now bn
   where bn.project_id = p_project_id
     and (   (bn.source_type = 'phase'    and bn.source_id = any(v_phase_ids))
          or (bn.source_type = 'material' and bn.source_id = any(v_material_ids)));

  update public.phases set billing_status = 'billed' where id = any(v_phase_ids);

  update public.stock_requests set billed_on_bill_id = v_bill.id where id = any(v_material_ids);

  insert into public.bill_events (bill_id, from_status, to_status, actor_id)
  values (v_bill.id, null, 'draft', auth.uid());

  perform public.fn_audit('bill', v_bill.id, 'insert', null, to_jsonb(v_bill));

  return v_bill;
exception
  when unique_violation then
    -- idx_bill_lines_source / bills_no_uq backstop, as a domain error.
    raise exception 'ALREADY_BILLED: one or more selected items were billed by a concurrent request'
      using errcode = '23505';
end;
$$;

revoke execute on function public.rpc_create_bill(uuid, jsonb, date, text, text, date, date) from public, anon;
grant execute on function public.rpc_create_bill(uuid, jsonb, date, text, text, date, date) to authenticated;

comment on function public.rpc_create_bill(uuid, jsonb, date, text, text, date, date) is
  'Admin-only. Creates a draft RA bill from v_billable_now. MAS rules R1–R6 (migration 20261124200001, D69): refuses MAS_SAME_BILL, MAS_DRAFT_PENDING, MAS_EXCEEDS_GROSS, INVALID_PERIOD. Duplicate selections are de-duplicated. bill_date defaults to today in Asia/Kolkata.';
