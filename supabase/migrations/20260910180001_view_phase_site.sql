-- 0019 — v_phase_site
--
-- 02-lld.md §4.3's role-scoped view set (migration 0014) covers v_package_site
-- but not phases, though the package-detail Budget tab — labelled "Phases" for
-- non-admins — renders for site too. Gap found while building Build 04's
-- PhaseTable conversion, not present in the original migration.
--
-- Same pattern as v_package_site: definer view, no money at all, not even the
-- client-facing figure.
create view public.v_phase_site
with (security_invoker = off) as
select
  ph.id,
  ph.project_id,
  ph.package_id,
  ph.seq_no,
  ph.name,
  ph.billing_status,
  (   (vb.task_count > 0 and vb.task_count = vb.tasks_done)
   or ph.manual_complete_at is not null ) as is_complete
from public.phases ph
join public.v_phase_billing vb on vb.phase_id = ph.id
where ph.deleted_at is null and public.is_member_of(ph.project_id);

comment on view public.v_phase_site is
  'Site-facing. OMITS allocated_amount and internal_amount — no money at all, matching v_package_site (01-hld.md §3).';

grant select on public.v_phase_site to authenticated;
