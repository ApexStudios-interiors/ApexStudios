-- Security hardening (audit 2026-11-24, APX-02): rpc_transition_bill no
-- longer hands internal cost or margin to a client
--
-- rpc_transition_bill returns the whole bills row (`select * … return
-- v_bill`), and certify / reject are CLIENT actions. The web app reads only
-- id, project_id, status and revision from the result, but the RPC is
-- callable directly with the client's own token, and the response carried
-- internal_cost_amount and margin_amount — the two columns v_bill_client
-- exists to omit.
--
-- Same fix, same reasoning as 20261007090006 §B did for
-- rpc_transition_stock_request: keep the return TYPE (changing it means
-- dropping the function, and every caller reads only id / project_id /
-- status / revision), and for anyone but an admin null the two fields in the
-- returned row. The audit row is unchanged. The body below is
-- 20261005090001's verbatim, plus that one step before the return.
--
-- rpc_create_bill and rpc_record_payment also return bills, but both refuse
-- any caller who is not an admin before doing anything, so they need no
-- change here.
CREATE OR REPLACE FUNCTION public.rpc_transition_bill(p_bill_id uuid, p_to_status bill_status, p_note text DEFAULT NULL::text)
 RETURNS bills
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    raise exception 'FORBIDDEN: requires admin' using errcode = '42501';
  end if;
  if v_from = 'certified' and p_to_status = 'paid' and not public.is_admin() then
    raise exception 'FORBIDDEN: requires admin' using errcode = '42501';
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

  -- APX-02: the internal block never leaves this function for a non-admin.
  if not coalesce(public.is_admin(), false) then
    v_bill.internal_cost_amount := null;
    v_bill.margin_amount := null;
  end if;
  return v_bill;
end;
$function$;

revoke execute on function public.rpc_transition_bill(uuid, public.bill_status, text) from public, anon;
grant execute on function public.rpc_transition_bill(uuid, public.bill_status, text) to authenticated;
