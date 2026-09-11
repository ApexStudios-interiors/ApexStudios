-- 0039 — the attachments freeze should also cover a soft-deleted approval
--
-- Pre-merge review of build/08-approvals.md (PR #12) found this: 0037's own
-- fix (`not exists (... where status <> 'pending')`) is vacuously true for a
-- row that exists, has been soft-deleted, but whose `status` column was
-- never changed off 'pending' — nothing in this codebase deletes an approval
-- today, but the column exists precisely so a future path can, and AGENTS.md
-- database rule 7 ("soft delete only... every query filters deleted_at is
-- null") makes no exception for RLS predicates. A soft-deleted approval is
-- not "still open" by any reading of that word, so it must freeze exactly
-- like a decided one.
--
-- Never edit an already-applied migration (AGENTS.md database rule 1) —
-- both policies are dropped and recreated again, not altered in place.
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
         where a.id = entity_id and (a.deleted_at is not null or a.status <> 'pending')
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
         where a.id = entity_id and (a.deleted_at is not null or a.status <> 'pending')
      )
    )
  );
