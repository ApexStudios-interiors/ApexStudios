-- 0022 — fix v_phase_client / v_phase_site: they returned zero rows, ever
--
-- Found live, not in review: querying v_phase_client as the seeded client
-- account returns an empty array even though the project has phases.
--
-- Root cause: both views (security_invoker = off, i.e. definer) joined
-- v_phase_billing to get task_count/tasks_done/is_complete. But 0013 sets
-- v_phase_billing itself to `security_invoker = on`, deliberately, so that a
-- direct query against it is gated by phases_select_admin/tasks_select's own
-- admin-only RLS. That is correct for a DIRECT query — but it means when a
-- definer view joins it, the join is evaluated with the ORIGINAL caller's
-- privileges, not the outer view owner's. A client or site session has no
-- SELECT on phases/tasks at all, so the join contributes zero rows no matter
-- what the outer view's own is_member_of() filter would have allowed.
--
-- v_package_site sidesteps this exact trap already, by computing its
-- open_requests/phase_count with its own correlated subqueries against base
-- tables instead of going through another view — this migration makes
-- v_phase_client and v_phase_site do the same for is_complete, rather than
-- touching v_phase_billing's grants or security mode, which v_billable_now
-- (02-lld.md §4.2, Build 09) depends on being exactly as it is today.
create or replace view public.v_phase_client
with (security_invoker = off) as
select
  ph.id,
  ph.project_id,
  ph.package_id,
  ph.seq_no,
  ph.name,
  ph.allocated_amount as contract_value,
  ph.billing_status,
  ( (t.task_count > 0 and t.task_count = t.tasks_done) or ph.manual_complete_at is not null ) as is_complete
from public.phases ph
left join lateral (
  select count(*) as task_count, count(*) filter (where tk.progress_pct = 100) as tasks_done
  from public.tasks tk
  where tk.phase_id = ph.id and tk.deleted_at is null
) t on true
where ph.deleted_at is null and public.is_member_of(ph.project_id);

comment on view public.v_phase_client is
  'Client-facing. OMITS internal_amount. billing_status is shown because the client needs to know what has been billed; the cost behind it is not. is_complete is computed inline against tasks directly (not via v_phase_billing) so this definer view does not depend on an invoker-mode view''s RLS evaluation — see this migration''s header.';

create or replace view public.v_phase_site
with (security_invoker = off) as
select
  ph.id, ph.project_id, ph.package_id, ph.seq_no, ph.name, ph.billing_status,
  ( (t.task_count > 0 and t.task_count = t.tasks_done) or ph.manual_complete_at is not null ) as is_complete
from public.phases ph
left join lateral (
  select count(*) as task_count, count(*) filter (where tk.progress_pct = 100) as tasks_done
  from public.tasks tk
  where tk.phase_id = ph.id and tk.deleted_at is null
) t on true
where ph.deleted_at is null and public.is_member_of(ph.project_id);

comment on view public.v_phase_site is
  'Site-facing. OMITS allocated_amount and internal_amount — no money at all, matching v_package_site (01-hld.md §3). is_complete is computed inline against tasks directly — see this migration''s header.';
