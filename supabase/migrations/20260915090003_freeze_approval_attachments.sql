-- 0036 — freeze attachments on a decided approval
--
-- build/08-approvals.md §2.2: "Once decided, the approval and its
-- attachments are frozen — this is the record that answers 'you approved
-- this finish' eighteen months later during a dispute." Enforced in two
-- places per the build's own instruction: the action layer refuses it
-- (features/approvals/actions.ts's `addSamplePhotos`) and RLS refuses it
-- too, "the layer that holds when the action layer is wrong." This
-- migration is the RLS half, on both the insert and the delete path —
-- 02-lld.md §6.1's own 24-hour uploader self-delete window must not apply
-- to an attachment on a decided approval either.
--
-- Never edit an already-applied migration (AGENTS.md database rule 1) — both
-- policies are dropped and recreated here rather than altered in 0011.
drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated
  with check (
    (project_id is null or public.is_member_of(project_id))
    and uploaded_by = auth.uid()
    and org_id = public.auth_org()
    and (
      entity_type <> 'approval'
      or exists (
        select 1 from public.approvals a
         where a.id = entity_id and a.status = 'pending'
      )
    )
  );

drop policy if exists att_delete_uploader on public.attachments;
create policy att_delete_uploader on public.attachments for delete to authenticated
  using (
    uploaded_by = auth.uid()
    and created_at > now() - interval '24 hours'
    and (
      entity_type <> 'approval'
      or exists (
        select 1 from public.approvals a
         where a.id = entity_id and a.status = 'pending'
      )
    )
  );
