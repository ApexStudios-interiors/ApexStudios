-- APX-22: a bill's date is the IST date it is first submitted.
--
-- bills.bill_date defaulted to the database's current_date, which is UTC, and
-- the app never sent a date — so a bill raised between 00:00 and 05:30 IST
-- carried the previous day's date. On 1 April that is the previous financial
-- year and the previous return period. rpc_create_bill now defaults to today
-- in Asia/Kolkata and the app always passes it (20261124200001); this fixes
-- the other half: a draft is not yet an invoice, and the date that matters is
-- the day it is issued.
--
-- So, on the FIRST draft -> submitted transition (old.submitted_at is null),
-- bill_date becomes today in Asia/Kolkata. A bill a client rejected back to
-- draft and that is then resubmitted keeps its first submission date: it was
-- already issued once, and re-dating it could move it into a different return
-- period after it has been reported. Whether a resubmitted bill should carry a
-- new date (or be a fresh invoice / credit note) is flagged for CA review
-- (D68).
--
-- A trigger rather than a change to rpc_transition_bill: the date rule then
-- holds whichever path moves the status, and the transition function is left
-- exactly as it is. The column default moves to the IST date too, for any
-- insert that does not name it.

create or replace function public.trg_bills_date_at_submit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'draft' and new.status = 'submitted' and old.submitted_at is null then
    new.bill_date := (now() at time zone 'Asia/Kolkata')::date;
  end if;
  return new;
end;
$$;

comment on function public.trg_bills_date_at_submit() is
  'APX-22 / D68: sets bills.bill_date to today in Asia/Kolkata on a bill''s first submission. A resubmission after rejection keeps the first date (CA review).';

drop trigger if exists trg_bills_date_at_submit on public.bills;
create trigger trg_bills_date_at_submit
  before update of status on public.bills
  for each row execute function public.trg_bills_date_at_submit();

alter table public.bills
  alter column bill_date set default ((now() at time zone 'Asia/Kolkata')::date);
