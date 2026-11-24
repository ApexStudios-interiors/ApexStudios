-- APX-66 — a hard delete of a project must not silently erase its evidence.
--
-- The app only ever soft-deletes (AGENTS.md database rule 7), but the
-- foreign keys from the evidence tables to projects were ON DELETE CASCADE.
-- One `delete from projects …` in the SQL editor — a cleanup, a mistaken
-- script — removed every approval a client signed, every site diary entry,
-- every stock request and every attachment row for that project, with no
-- error and no audit trail. These are exactly the records GST retention and
-- a dispute rely on.
--
-- Now RESTRICT: such a delete fails, naming the constraint, and the operator
-- has to decide deliberately. Child rows of these tables (stock_request_events
-- and the like) keep their own cascades; they can only be reached once the
-- parent itself is deleted on purpose.
--
-- NOT VALID then VALIDATE: the new constraint is added without a full-table
-- lock-and-scan, then checked separately (a SHARE UPDATE EXCLUSIVE lock that
-- does not block reads or writes). Every existing row already satisfies it —
-- it is the same reference with a different ON DELETE action.

alter table public.stock_requests
  drop constraint stock_requests_project_id_fkey,
  add constraint stock_requests_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict not valid;
alter table public.stock_requests validate constraint stock_requests_project_id_fkey;

alter table public.approvals
  drop constraint approvals_project_id_fkey,
  add constraint approvals_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict not valid;
alter table public.approvals validate constraint approvals_project_id_fkey;

alter table public.daily_updates
  drop constraint daily_updates_project_id_fkey,
  add constraint daily_updates_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict not valid;
alter table public.daily_updates validate constraint daily_updates_project_id_fkey;

alter table public.attachments
  drop constraint attachments_project_id_fkey,
  add constraint attachments_project_id_fkey
    foreign key (project_id) references public.projects(id) on delete restrict not valid;
alter table public.attachments validate constraint attachments_project_id_fkey;
