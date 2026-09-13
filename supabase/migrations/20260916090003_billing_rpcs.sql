-- 0042 — rpc_create_bill, rpc_transition_bill, rpc_record_payment
--
-- build/09-billing.md §2/§4.1-4.3, 02-lld.md §5.5-5.7. The arithmetic order
-- is fixed and is the entire point of this build (AGENTS.md billing rules):
--
--   A work_value  Σ completed phase milestones × client value
--   B material_value  Σ delivered material × client value × mas_billable_pct
--   C gross       A + B
--   D mas_recovery  material previously advanced under B whose phase is now
--                    billed in full under A (the anti-double-billing guard)
--   E taxable     C - D                                  ← THE GST BASE
--   F gst         E * gst_rate_pct                        ← on E, NEVER E - retention
--   G invoice_total  E + F
--   H retention   E * retention_pct                       ← on basic value, after GST
--   I tds         E * tds_pct                              (informational, D5)
--   J advance_recovery  least(remaining mobilisation advance, E * mobilisation_recovery_pct)
--   K net_payable G - H - I - J
--
-- Deducting retention before computing GST is the prototype's own bug
-- (lib/logic.ts's billTotals) and T-01 exists specifically to catch a
-- reintroduction of it.

-- ── Create ───────────────────────────────────────────────────────────────────
create or replace function public.rpc_create_bill(
  p_project_id      uuid,
  p_lines           jsonb,                  -- [{source_type, source_id}, ...]
  p_bill_date       date default current_date,
  p_notes           text default null,
  p_idempotency_key text default null
) returns public.bills
language plpgsql security definer
set search_path = ''
as $$
declare
  v_project           public.projects%rowtype;
  v_existing          public.bills;
  v_bill              public.bills;
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
  v_line_count        int;
  v_phase_ids         uuid[];
  v_seq               int;
  v_bill_no           text;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: rpc_create_bill is admin-only' using errcode = '42501';
  end if;
  if not public.is_member_of(p_project_id) then
    raise exception 'FORBIDDEN: not a member of project %', p_project_id using errcode = '42501';
  end if;

  -- Row lock FIRST: this is what serialises next_bill_seq into gapless,
  -- non-duplicate RA bill numbers (T-03) — a plain count(*)+1 races and can
  -- produce two RA-BHEL-NCH-03s. It also makes the idempotency check below
  -- race-free: a concurrent duplicate call blocks here until the first
  -- commits, so by the time it proceeds the first call's insert (if it
  -- carried the same key) is already visible.
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

  select
    coalesce(sum(amount) filter (where source_type = 'phase'), 0),
    coalesce(sum(amount) filter (where source_type = 'material'), 0),
    coalesce(sum(internal_cost), 0),
    array_agg(source_id) filter (where source_type = 'phase'),
    count(*)
    into v_work_value, v_material_value, v_internal_cost, v_phase_ids, v_line_count
    from public.v_billable_now bn
    join jsonb_to_recordset(p_lines) as sel(source_type public.bill_line_source, source_id uuid)
      on sel.source_type = bn.source_type and sel.source_id = bn.source_id
   where bn.project_id = p_project_id;

  if v_line_count = 0 then
    raise exception 'NOTHING_SELECTED: no billable lines matched the selection' using errcode = '23514';
  end if;
  if v_line_count <> jsonb_array_length(p_lines) then
    -- Some selected (source_type, source_id) pairs didn't resolve against
    -- v_billable_now — the view already excludes anything with an existing
    -- bill_line, so the only realistic cause is a concurrent bill (by a
    -- different admin, on a different item) landing between this page load
    -- and this submit. A clean error beats silently billing a smaller
    -- selection than what was actually ticked.
    raise exception 'ALREADY_BILLED: one or more selected items are no longer billable' using errcode = '23514';
  end if;

  v_gross := v_work_value + v_material_value;

  -- MAS recovery (build §4.1 step 5, T-02): prior material bill_lines whose
  -- stock_request.phase_id is among the phases now being billed as complete.
  -- 75% was advanced against that material; its phase is now billed in full,
  -- so the advance is recovered here rather than billing the client twice
  -- for the same marble.
  select coalesce(sum(bl.amount), 0) into v_mas_recovery
    from public.bill_lines bl
    join public.stock_requests sr on sr.id = bl.source_id
   where bl.source_type = 'material' and sr.phase_id = any(v_phase_ids);

  -- MAS recovery exceeding gross: taxable floors at zero rather than going
  -- negative — a negative GST base is not a meaningful figure, and this is
  -- the build's own explicitly-named "decide and assert the behaviour" case.
  v_taxable := greatest(v_gross - v_mas_recovery, 0);

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

  v_seq     := v_project.next_bill_seq;
  v_bill_no := 'RA-' || v_project.code || '-' || lpad(v_seq::text, 2, '0');
  update public.projects
     set next_bill_seq = next_bill_seq + 1,
         mobilisation_recovered = mobilisation_recovered + v_advance_recovery
   where id = p_project_id;

  -- Rates snapshotted from the project NOW, at creation (ADR-006) — a later
  -- change to projects.gst_rate_pct must never restate an issued bill.
  insert into public.bills (
    org_id, project_id, seq_no, bill_no, bill_date, notes,
    work_value, material_value, gross_amount, mas_recovery_amount,
    taxable_amount, gst_amount, invoice_total, retention_amount, tds_amount,
    advance_recovery, net_payable, internal_cost_amount, margin_amount,
    gst_rate_pct, retention_pct, tds_pct, idempotency_key, created_by
  ) values (
    v_project.org_id, p_project_id, v_seq, v_bill_no, p_bill_date, p_notes,
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
    join jsonb_to_recordset(p_lines) as sel(source_type public.bill_line_source, source_id uuid)
      on sel.source_type = bn.source_type and sel.source_id = bn.source_id
   where bn.project_id = p_project_id;

  update public.phases set billing_status = 'billed' where id = any(v_phase_ids);

  update public.stock_requests sr set billed_on_bill_id = v_bill.id
   where exists (
     select 1 from public.bill_lines bl
      where bl.bill_id = v_bill.id and bl.source_type = 'material' and bl.source_id = sr.id
   );

  insert into public.bill_events (bill_id, from_status, to_status, actor_id)
  values (v_bill.id, null, 'draft', auth.uid());

  perform public.fn_audit('bill', v_bill.id, 'insert', null, to_jsonb(v_bill));

  return v_bill;
exception
  when unique_violation then
    -- idx_bill_lines_source's own backstop (build §4.1's own wording) — the
    -- project row lock above already makes this practically unreachable for
    -- two calls on the SAME project, but a clean domain error is still owed
    -- to whatever calls this path, rather than a raw constraint name.
    raise exception 'ALREADY_BILLED: one or more selected items were billed by a concurrent request'
      using errcode = '23505';
end;
$$;

revoke execute on function public.rpc_create_bill(uuid, jsonb, date, text, text) from public, anon;
grant execute on function public.rpc_create_bill(uuid, jsonb, date, text, text) to authenticated;

-- ── Transition ───────────────────────────────────────────────────────────────
-- 02-lld.md §5.6. The table is the specification:
--   draft     -> submitted  admin/owner   lines freeze; bill.pdf enqueued (app layer)
--   draft     -> cancelled  admin/owner   deletes bill_lines, resets phases, clears billed_on_bill_id
--   submitted -> certified  CLIENT ONLY   certified_by, certified_at
--   submitted -> draft      CLIENT ONLY   rejection; reason mandatory; revision += 1
--   certified -> paid       admin/owner   requires Σ payments >= net_payable
-- Anything else raises ILLEGAL_TRANSITION. An admin attempting
-- submitted -> certified raises FORBIDDEN — not a state-machine question, a
-- role one, and the one constraint with no exceptions (01-hld.md §7.1's own
-- "deliberate negative" — the same rule rpc_decide_approval enforces for
-- approvals; no admin bypass, including for testing, AGENTS.md).
create or replace function public.rpc_transition_bill(
  p_bill_id   uuid,
  p_to_status public.bill_status,
  p_note      text default null
) returns public.bills
language plpgsql security definer
set search_path = ''
as $$
declare
  v_bill      public.bills;
  v_role      public.app_role;
  v_from      public.bill_status;
  v_paid      numeric(14,2);
  v_phase_ids uuid[];
begin
  select * into v_bill from public.bills where id = p_bill_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: bill % does not exist', p_bill_id using errcode = 'P0002';
  end if;
  if not public.is_member_of(v_bill.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', v_bill.project_id using errcode = '42501';
  end if;

  v_role := public.auth_role();
  v_from := v_bill.status;

  if v_from = 'submitted' and p_to_status = 'certified' and v_role <> 'client' then
    raise exception 'FORBIDDEN: only a client may certify a bill' using errcode = '42501';
  end if;
  if v_from = 'submitted' and p_to_status = 'draft' and v_role <> 'client' then
    raise exception 'FORBIDDEN: only a client may reject a bill' using errcode = '42501';
  end if;
  if v_from = 'draft' and p_to_status in ('submitted', 'cancelled') and not public.is_admin() then
    raise exception 'FORBIDDEN: requires owner or admin' using errcode = '42501';
  end if;
  if v_from = 'certified' and p_to_status = 'paid' and not public.is_admin() then
    raise exception 'FORBIDDEN: requires owner or admin' using errcode = '42501';
  end if;

  if v_from = 'submitted' and p_to_status = 'draft' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'REASON_REQUIRED: a reason is required to reject a bill' using errcode = '23514';
  end if;

  if v_from = 'certified' and p_to_status = 'paid' then
    select coalesce(sum(amount), 0) into v_paid from public.payments where bill_id = p_bill_id;
    if v_paid < v_bill.net_payable then
      raise exception 'ILLEGAL_TRANSITION: payments (%) do not yet cover net_payable (%)', v_paid, v_bill.net_payable
        using errcode = '23514';
    end if;
  end if;

  select array_agg(source_id) into v_phase_ids
    from public.bill_lines where bill_id = p_bill_id and source_type = 'phase';

  if v_from = 'draft' and p_to_status = 'submitted' then
    update public.bills set status = 'submitted', submitted_at = now(), submitted_by = auth.uid()
     where id = p_bill_id;

  elsif v_from = 'draft' and p_to_status = 'cancelled' then
    -- The one place this system hard-deletes rows, deliberately: freeing
    -- idx_bill_lines_source is what returns these items to Billable Now.
    -- Comment it as an exception so nobody "fixes" it into a soft delete.
    delete from public.bill_lines where bill_id = p_bill_id;
    update public.phases set billing_status = 'billable' where id = any(v_phase_ids);
    update public.stock_requests set billed_on_bill_id = null where billed_on_bill_id = p_bill_id;
    -- A cancelled draft's "recovered" advance was never actually netted
    -- against a real invoice — reverse it, or the mobilisation ledger
    -- permanently overstates what has actually been recovered.
    update public.projects
       set mobilisation_recovered = greatest(mobilisation_recovered - v_bill.advance_recovery, 0)
     where id = v_bill.project_id;
    update public.bills set status = 'cancelled' where id = p_bill_id;

  elsif v_from = 'submitted' and p_to_status = 'certified' then
    update public.bills
       set status = 'certified', certified_at = now(), certified_by = auth.uid(), certification_note = p_note
     where id = p_bill_id;

  elsif v_from = 'submitted' and p_to_status = 'draft' then
    update public.bills set status = 'draft', revision = revision + 1 where id = p_bill_id;

  elsif v_from = 'certified' and p_to_status = 'paid' then
    update public.bills set status = 'paid', paid_at = now() where id = p_bill_id;
    update public.phases set billing_status = 'paid' where id = any(v_phase_ids);

  else
    raise exception 'ILLEGAL_TRANSITION: % to % is not a legal transition', v_from, p_to_status
      using errcode = '23514';
  end if;

  insert into public.bill_events (bill_id, from_status, to_status, actor_id, note)
  values (p_bill_id, v_from, p_to_status, auth.uid(), p_note);

  select * into v_bill from public.bills where id = p_bill_id;
  perform public.fn_audit(
    'bill', p_bill_id, 'transition',
    jsonb_build_object('status', v_from), jsonb_build_object('status', p_to_status)
  );
  return v_bill;
end;
$$;

revoke execute on function public.rpc_transition_bill(uuid, public.bill_status, text) from public, anon;
grant execute on function public.rpc_transition_bill(uuid, public.bill_status, text) to authenticated;

-- ── Record payment ───────────────────────────────────────────────────────────
-- build §4.3. Part-payment is normal in Indian construction, which is why
-- payments are a table and not a paid_amount column — Outstanding is
-- Σ bills.net_payable (certified/paid) − Σ payments.amount, computed at read
-- time, never stored.
--
-- Overpayment is REFUSED, not accepted with a warning (build's own "decide,
-- document, and test whichever" — this is that decision, recorded in
-- docs/decisions.md): a payment that would push the running total past
-- net_payable is a data-entry error far more often than a real overpayment,
-- and a clean error asking someone to check the figure beats ever showing a
-- negative Outstanding on the dashboard.
create or replace function public.rpc_record_payment(
  p_bill_id         uuid,
  p_amount          numeric,
  p_paid_on         date,
  p_mode            text default null,
  p_reference_no    text default null,
  p_idempotency_key text default null
) returns public.bills
language plpgsql security definer
set search_path = ''
as $$
declare
  v_bill     public.bills;
  v_paid     numeric(14,2);
  v_payment  public.payments;
  v_existing uuid;
begin
  if not public.is_admin() then
    raise exception 'FORBIDDEN: rpc_record_payment is admin-only' using errcode = '42501';
  end if;

  select * into v_bill from public.bills where id = p_bill_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND: bill % does not exist', p_bill_id using errcode = 'P0002';
  end if;
  if not public.is_member_of(v_bill.project_id) then
    raise exception 'FORBIDDEN: not a member of project %', v_bill.project_id using errcode = '42501';
  end if;
  if v_bill.status not in ('certified', 'paid') then
    raise exception 'ILLEGAL_TRANSITION: payments can only be recorded on a certified or paid bill'
      using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'REASON_REQUIRED: payment amount must be positive' using errcode = '23514';
  end if;

  if p_idempotency_key is not null then
    select id into v_existing from public.payments
     where bill_id = p_bill_id and idempotency_key = p_idempotency_key;
    if found then
      return v_bill; -- already recorded; the bill's current state already reflects it
    end if;
  end if;

  select coalesce(sum(amount), 0) into v_paid from public.payments where bill_id = p_bill_id;

  if v_paid + p_amount > v_bill.net_payable then
    raise exception 'OVERPAYMENT: this payment would exceed the amount owed on this bill' using errcode = '23514';
  end if;

  insert into public.payments (org_id, bill_id, amount, paid_on, mode, reference_no, idempotency_key, created_by)
  values (v_bill.org_id, p_bill_id, p_amount, p_paid_on, p_mode, p_reference_no, p_idempotency_key, auth.uid())
  returning * into v_payment;

  if v_bill.status = 'certified' and v_paid + p_amount >= v_bill.net_payable then
    update public.bills set status = 'paid', paid_at = now() where id = p_bill_id;
    update public.phases set billing_status = 'paid'
     where id in (
       select source_id from public.bill_lines where bill_id = p_bill_id and source_type = 'phase'
     );
    insert into public.bill_events (bill_id, from_status, to_status, actor_id, note)
    values (p_bill_id, 'certified', 'paid', auth.uid(), 'Auto-transitioned: payment received in full');
  end if;

  perform public.fn_audit('payment', v_payment.id, 'insert', null, to_jsonb(v_payment));

  select * into v_bill from public.bills where id = p_bill_id;
  return v_bill;
exception
  when unique_violation then
    -- payments_idem_uq's own backstop for the same (bill_id, idempotency_key)
    -- racing past the lookup above before either commits.
    select * into v_bill from public.bills where id = p_bill_id;
    return v_bill;
end;
$$;

revoke execute on function public.rpc_record_payment(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.rpc_record_payment(uuid, numeric, date, text, text, text) to authenticated;
