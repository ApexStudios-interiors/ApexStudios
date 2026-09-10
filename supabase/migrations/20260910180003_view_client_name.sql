-- 0021 — v_client_name: the one column-isolation gap Build 04 actually needs
--
-- 0003's own comment on public.clients says "a client user does not read the
-- clients table; their own project reaches them through projects and the
-- role-scoped views" — but no such view existed. projects_select already lets
-- any project member (client and site included, via is_member_of) read the
-- project row itself; the gap is only the client_id -> clients.name join,
-- because clients_select is is_admin()-only (contact_person, email, phone,
-- gstin and billing_address are genuinely admin-only, and there is no reason
-- to build four separate role-scoped client views for one string).
--
-- Without this, the portfolio and dashboard pages (both required by this
-- build, for every role) render an empty client name for site and client
-- sessions — caught before it shipped by re-reading 0003's own comment rather
-- than by a failing test.
create view public.v_client_name
with (security_invoker = off) as
select c.id, c.name
from public.clients c
where exists (
  select 1 from public.projects p
  where p.client_id = c.id and p.deleted_at is null and public.is_member_of(p.id)
);

comment on view public.v_client_name is
  'Non-admin-safe. Exposes ONLY id and name — never contact_person, email, phone, gstin or billing_address, which stay admin-only on the base clients table. Scoped to clients backing a project the caller is a member of, mirroring projects_select''s own is_member_of() gate. Admin reads clients directly and has no need of this view.';

grant select on public.v_client_name to authenticated;
