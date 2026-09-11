-- 0026 — projects.next_sr_seq
--
-- build/07-stock-inventory-notifications.md, D18: SR-{project_code}-{n}, one
-- counter per project — the exact pattern `next_bill_seq` already uses for
-- bill numbers. Incremented under a row lock inside rpc_create_stock_request,
-- never a `count(*) + 1` in application code, which races and produces
-- duplicate reference numbers sent to suppliers.

alter table public.projects add column next_sr_seq int not null default 1;
