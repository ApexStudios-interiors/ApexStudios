-- 0040 — mobilisation advance recovery rate
--
-- build/09-billing.md §0.2 / §4.1 step 6: "adv_recovery := least(remaining
-- mobilisation advance, taxable * recovery_rate)" — 02-lld.md §5.5's own
-- pseudo-implementation already assumes a per-project recovery rate exists;
-- D7 (answered yes, 2026-09-09) tracks the advance and its recovery, but the
-- rate itself was never added. Same shape as gst_rate_pct/retention_pct/
-- tds_pct/mas_billable_pct — a per-project percentage, never hard-coded
-- (AGENTS.md).
--
-- Default 0: no live contract's actual recovery schedule has been confirmed
-- (build §0.2 asks explicitly and it is still open — see docs/decisions.md).
-- A 0% rate recovers nothing automatically, which is the safe default until
-- a real project sets its own rate; it does not invent a schedule nobody
-- has specified.
alter table public.projects
  add column mobilisation_recovery_pct numeric(6,3) not null default 0;

alter table public.projects
  add constraint projects_mob_recovery_pct_ck check (mobilisation_recovery_pct between 0 and 100);

comment on column public.projects.mobilisation_recovery_pct is
  'Per-bill recovery rate applied to the taxable amount, capped by the remaining mobilisation_advance - mobilisation_recovered balance. 0 until a project''s real schedule is confirmed (build/09-billing.md §0.2, still open).';
