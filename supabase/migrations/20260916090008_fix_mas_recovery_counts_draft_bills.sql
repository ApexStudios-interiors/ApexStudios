-- 0046 — fix 0045 (0044/0042): rpc_create_bill's MAS recovery counted
-- material bill_lines from a still-draft bill, not only committed ones.
--
-- The MAS recovery join summed every prior material `bill_lines` row whose
-- stock_request.phase_id matches a phase now being billed, with no filter
-- on the OWNING bill's own status. A draft bill is not yet a real invoice —
-- "bills are immutable from submitted onward" (AGENTS.md) implies a draft
-- one still can be, and per `rpc_transition_bill`'s own `draft -> cancelled`
-- branch, its `bill_lines` are the one deliberate hard-delete exception to
-- soft delete. Sequence that exposes the bug: admin bills a delivered
-- material against phase P as bill A (still draft, not yet submitted or
-- cancelled), then bills phase P's own completed milestone as bill B before
-- resolving A. B's `mas_recovery_amount` is reduced by A's material line
-- even though A isn't a finalized invoice; if A is later cancelled, B's
-- already-snapshotted taxable/GST/net figures permanently understate what
-- the client owes, with no correction possible once B is submitted
-- (rates and derived figures are snapshotted, never recomputed).
--
-- Found in a pre-merge review pass, not by a live smoke test. Fixed by
-- joining `bills` and excluding `draft` — a cancelled bill's own lines are
-- already gone by the time this query would ever see them, so `<> 'draft'`
-- is exactly "submitted, certified, or paid," i.e. a real invoice.
--
-- Never edit an already-applied migration (AGENTS.md database rule 1) —
-- the whole function is recreated here again, not altered in place in 0045.
create or replace function public.rpc_create_bill(
  p_project_id      uuid,
  p_lines           jsonb,
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

  select * into v_project from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'NOT_FOUND: project % does not exist', p_project_id using errcode = 'P0002';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.bills
     where project_id = p_project_id and idempotency_key = p_idempotency_key and deleted_at is null;
    if found then
      return v_existing;
    end if;
  end if;

  select
    coalesce(sum(bn.amount) filter (where bn.source_type = 'phase'), 0),
    coalesce(sum(bn.amount) filter (where bn.source_type = 'material'), 0),
    coalesce(sum(bn.internal_cost), 0),
    array_agg(bn.source_id) filter (where bn.source_type = 'phase'),
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
    raise exception 'ALREADY_BILLED: one or more selected items are no longer billable' using errcode = '23514';
  end if;

  v_gross := v_work_value + v_material_value;

  -- Only a committed bill's own material lines count toward MAS recovery —
  -- a still-draft one (b.status = 'draft') might yet be cancelled, at which
  -- point its bill_lines are hard-deleted and never should have reduced
  -- another bill's taxable value in the first place.
  select coalesce(sum(bl.amount), 0) into v_mas_recovery
    from public.bill_lines bl
    join public.stock_requests sr on sr.id = bl.source_id
    join public.bills b on b.id = bl.bill_id
   where bl.source_type = 'material' and sr.phase_id = any(v_phase_ids) and b.status <> 'draft';

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

  v_seq := v_project.next_bill_seq;
  -- Zero-pad to 2 digits for seq < 100 ('1' -> '01'); at or past 100, the
  -- number is already wider than 2 characters and is used as-is. Never
  -- lpad(v_seq::text, 2, '0') directly — that truncates a 3+ digit number
  -- to its own leftmost 2 characters instead of leaving it alone.
  v_bill_no := 'RA-' || v_project.code || '-' ||
    case when v_seq < 10 then '0' || v_seq::text else v_seq::text end;
  update public.projects
     set next_bill_seq = next_bill_seq + 1,
         mobilisation_recovered = mobilisation_recovered + v_advance_recovery
   where id = p_project_id;

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
    raise exception 'ALREADY_BILLED: one or more selected items were billed by a concurrent request'
      using errcode = '23505';
end;
$$;

revoke execute on function public.rpc_create_bill(uuid, jsonb, date, text, text) from public, anon;
grant execute on function public.rpc_create_bill(uuid, jsonb, date, text, text) to authenticated;
