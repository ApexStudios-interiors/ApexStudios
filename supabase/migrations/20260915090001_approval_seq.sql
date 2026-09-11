-- 0034 — projects.next_ap_seq
--
-- build/08-approvals.md §0: one reference-number convention for both
-- entities — AP-{project_code}-{n}, one counter per project, the exact
-- pattern next_sr_seq (D18, Build 07) and next_bill_seq already use.
-- Incremented under a row lock inside rpc_create_approval, never a
-- `count(*) + 1` in application code, which races and produces duplicate
-- reference numbers on the same record a client and a supplier both see.
alter table public.projects add column next_ap_seq int not null default 1;
