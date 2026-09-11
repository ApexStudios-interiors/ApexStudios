-- 0037 — fix 0036: the freeze predicate blocked the create flow, not just decisions
--
-- 0036's own predicate — "insert allowed only if a PENDING approval already
-- exists" — silently broke `NewApprovalDialog`'s create flow: `p_id` is
-- client-generated precisely so `FileUploader`'s sample photos can upload
-- and confirm BEFORE `rpc_create_approval` ever runs (0035's own comment,
-- the same pattern `daily_updates` established in Build 06). At that moment
-- no approval row with that id exists yet, so 0036's `exists (... and
-- status = 'pending')` check evaluated false and refused every one of those
-- uploads — never exercised by this build's own verification, which only
-- ever tested the freeze against an approval that already existed.
--
-- The rule this build actually asks for is narrower: refuse only once a row
-- exists and has moved past pending. No row yet (creation in progress, or an
-- orphaned upload from an abandoned dialog — the same accepted risk
-- `daily_updates` already carries) is not "decided" and must not be treated
-- as if it were. Never edit an already-applied migration (AGENTS.md database
-- rule 1) — both policies are dropped and recreated again, not altered in
-- place.
drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated
  with check (
    (project_id is null or public.is_member_of(project_id))
    and uploaded_by = auth.uid()
    and org_id = public.auth_org()
    and (
      entity_type <> 'approval'
      or not exists (
        select 1 from public.approvals a
         where a.id = entity_id and a.status <> 'pending'
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
      or not exists (
        select 1 from public.approvals a
         where a.id = entity_id and a.status <> 'pending'
      )
    )
  );
