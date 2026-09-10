-- 0008 — client approvals
--
-- 02-lld.md §3.6. Only a Client may decide an approval; an Admin performing it
-- would destroy the audit value of the whole chain. That is enforced in
-- rpc_decide_approval (Build 08), and there is deliberately no update policy
-- here for anyone to bypass it with.

create table public.approvals (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.orgs(id),
  project_id      uuid not null references public.projects(id) on delete cascade,
  package_id      uuid not null references public.packages(id),
  phase_id        uuid references public.phases(id),
  ref_no          text not null,                     -- 'AP-BHEL-NCH-007'
  type            public.approval_type not null,
  item            text not null,
  note            text,
  needed_by       date,
  status          public.approval_status not null default 'pending',
  requested_by    uuid not null references public.profiles(id),
  decided_by      uuid references public.profiles(id),
  decided_at      timestamptz,
  decision_reason text,
  supersedes_id   uuid references public.approvals(id),
  created_at      timestamptz not null default now(),
  -- created_by/updated_by are the standard 02-lld.md §1.3 audit pair, distinct
  -- from requested_by and decided_by, which are the domain actors.
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id),
  deleted_at      timestamptz,
  constraint ap_ref_uq unique (org_id, ref_no),
  constraint ap_reject_ck check (status <> 'rejected' or decision_reason is not null),
  -- Makes "decided but no timestamp" and "pending but decided" both
  -- unrepresentable. A constraint like this is cheaper than the test that would
  -- otherwise have to catch the bug.
  constraint ap_decided_ck check ((status = 'pending') = (decided_at is null))
);

create index idx_ap_project_status on public.approvals (project_id, status) where deleted_at is null;
create index idx_ap_org on public.approvals (org_id);

alter table public.approvals enable row level security;
alter table public.approvals force row level security;

-- Approvals carry no money, so every member reads them — including the client,
-- who is the one who has to act.
create policy ap_select on public.approvals for select to authenticated
  using ( deleted_at is null and public.is_member_of(project_id) );

create policy ap_insert on public.approvals for insert to authenticated
  with check ( public.is_member_of(project_id)
               and public.auth_role() in ('owner', 'admin', 'site')
               and org_id = public.auth_org() );

-- No update policy: decisions go through rpc_decide_approval, which is the only
-- place the client-only rule lives.
