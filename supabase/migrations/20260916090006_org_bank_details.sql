-- 0045 — org bank details, for the bill PDF
--
-- build/09-billing.md §4.6: the PDF "must carry... the bank details" —
-- §0.2's own "Apex's invoice header" prerequisite list names them
-- explicitly alongside legal_name/gstin/pan/address, which already exist
-- (migration 0003) but never got their own columns for this. Same shape,
-- same PLACEHOLDER convention as those: nullable, seeded with an obvious
-- placeholder, real values still owed by Voola (docs/decisions.md).
alter table public.orgs
  add column bank_name        text,
  add column bank_account_no  text,
  add column bank_ifsc        text;

comment on column public.orgs.bank_name is 'Printed on the bill PDF (build §4.6). PLACEHOLDER until provided.';
comment on column public.orgs.bank_account_no is 'Printed on the bill PDF (build §4.6). PLACEHOLDER until provided.';
comment on column public.orgs.bank_ifsc is 'Printed on the bill PDF (build §4.6). PLACEHOLDER until provided.';
