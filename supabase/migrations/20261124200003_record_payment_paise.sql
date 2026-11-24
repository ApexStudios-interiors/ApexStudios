-- APX-60: a payment is rounded to the paisa BEFORE it is compared.
--
-- rpc_record_payment compared and summed the raw p_amount, but stored it in a
-- numeric(14,2) column. A payment of 99.995 on a bill whose net payable is
-- 100.00 was stored as 100.00, yet `v_paid + 99.995 >= 100.00` was false, so
-- the bill stayed certified although it had been paid in full. The amount is
-- now rounded half-up to two decimals first, and every comparison, the insert
-- and the auto-transition use that one figure. An amount that rounds to 0.00
-- is refused like any other non-positive amount. The form refuses more than
-- two decimals as well (features/billing/schema.ts); this is the backstop.
--
-- Signature unchanged, so `create or replace` keeps the grants.

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
  v_amount   numeric(14,2);
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

  v_amount := round(p_amount, 2);
  if v_amount is null or v_amount <= 0 then
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

  if v_paid + v_amount > v_bill.net_payable then
    raise exception 'OVERPAYMENT: this payment would exceed the amount owed on this bill' using errcode = '23514';
  end if;

  insert into public.payments (org_id, bill_id, amount, paid_on, mode, reference_no, idempotency_key, created_by)
  values (v_bill.org_id, p_bill_id, v_amount, p_paid_on, p_mode, p_reference_no, p_idempotency_key, auth.uid())
  returning * into v_payment;

  if v_bill.status = 'certified' and v_paid + v_amount >= v_bill.net_payable then
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
