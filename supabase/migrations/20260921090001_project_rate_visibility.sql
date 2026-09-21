-- 0051 — projects.rate_visibility: per-project Rate visibility for site supervisors
--
-- D55 (docs/decisions.md), owner decision 2026-09-21. AGENTS.md's headline rule
-- is that a Site Supervisor sees no money at all. This column is the single,
-- explicit, per-project exception to it, and it defaults to 'hidden' so that
-- nothing changes anywhere until an owner/admin deliberately switches a project
-- on.
--
--   hidden    (default) — the Rate field is not rendered for site, and a `rate`
--                         in a crafted request is discarded.
--   readonly            — site sees the field, disabled; a submitted `rate` is
--                         still discarded.
--   editable            — site may enter a rate and it is stored.
--
-- A check constraint rather than a new enum type: the three modes are a
-- property of this one column, an enum would need its own migration to extend,
-- and nothing else in the schema refers to them.
--
-- Scope of the exception, deliberately narrow: this widens what a site
-- supervisor may TYPE on the New Stock Request form. It does NOT widen what a
-- site session may READ — `v_stock_request_site` still omits `rate`
-- (migration 0014), the stock list still renders the Value column for admin
-- only, and no role-scoped view changes here.
--
-- Not indexed: it appears in no RLS policy predicate (AGENTS.md database rule 5)
-- and is only ever read by primary key alongside the project row itself.

alter table public.projects
  add column rate_visibility text not null default 'hidden';

alter table public.projects
  add constraint projects_rate_visibility_ck
  check (rate_visibility in ('hidden', 'readonly', 'editable'));

comment on column public.projects.rate_visibility is
  'D55. Whether a Site Supervisor may see/enter the per-unit Rate on a stock request for this project: hidden (default), readonly, editable. The single per-project exception to "Site Supervisors see no money"; it governs WRITING a rate on the request form only, never reading one back — v_stock_request_site still omits rate.';

-- rpc_create_project is deliberately untouched. It names its insert columns
-- explicitly and does not list rate_visibility, so every project it creates
-- takes the 'hidden' default. Its signature, body and grants are unchanged.

-- ── rpc_create_stock_request ─────────────────────────────────────────────────
-- Identical to migration 0027's definition (same signature, so no drop and the
-- existing grant carries over) except for the `rate` expression in the insert,
-- which now consults the project's rate_visibility for a site caller.
--
-- This is the hard boundary. features/stock/actions.ts strips `rate` before the
-- call for anyone who may not set one, but a security definer function is the
-- actual write path regardless of what called it, so the same rule is decided
-- again here.
create or replace function public.rpc_create_stock_request(
  p_project_id        uuid,
  p_package_id        uuid,
  p_material_name     text,
  p_qty               numeric,
  p_unit              text,
  p_phase_id          uuid default null,
  p_inventory_item_id uuid default null,
  p_rate              numeric default null,
  p_needed_by         date default null,
  p_note              text default null
) returns public.stock_requests
language plpgsql security definer
set search_path = ''
as $$
declare
  v_role       public.app_role;
  v_seq        int;
  v_code       text;
  v_ref        text;
  v_visibility text;
  v_row        public.stock_requests;
begin
  v_role := public.auth_role();

  if not public.is_member_of(p_project_id) then
    raise exception 'FORBIDDEN: not a member of project %', p_project_id using errcode = '42501';
  end if;
  if v_role not in ('owner', 'admin', 'site') then
    raise exception 'FORBIDDEN: requires owner, admin or site' using errcode = '42501';
  end if;
  if btrim(coalesce(p_material_name, '')) = '' then
    raise exception 'REASON_REQUIRED: material name is required' using errcode = '23514';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'REASON_REQUIRED: quantity must be positive' using errcode = '23514';
  end if;

  select next_sr_seq, code, rate_visibility into v_seq, v_code, v_visibility
    from public.projects where id = p_project_id for update;
  if not found then
    raise exception 'NOT_FOUND: project % does not exist', p_project_id using errcode = 'P0002';
  end if;
  update public.projects set next_sr_seq = next_sr_seq + 1 where id = p_project_id;
  v_ref := 'SR-' || v_code || '-' || lpad(v_seq::text, 3, '0');

  insert into public.stock_requests (
    org_id, project_id, package_id, phase_id, ref_no, inventory_item_id,
    material_name, qty, unit, rate, needed_by, note, requested_by, created_by
  ) values (
    public.auth_org(), p_project_id, p_package_id, p_phase_id, v_ref, p_inventory_item_id,
    p_material_name, p_qty, p_unit,
    -- Owner/admin: always, unchanged. Site: only where this project is
    -- explicitly set to 'editable' (D55) — 'hidden' and 'readonly' both
    -- discard whatever was sent. Any other role never reaches this line.
    case
      when v_role in ('owner', 'admin') then p_rate
      when v_role = 'site' and v_visibility = 'editable' then p_rate
      else null
    end,
    p_needed_by, p_note, auth.uid(), auth.uid()
  ) returning * into v_row;

  perform public.fn_audit('stock_request', v_row.id, 'insert', null, to_jsonb(v_row));
  return v_row;
end;
$$;

revoke execute on function public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text) from public, anon;
grant execute on function public.rpc_create_stock_request(uuid, uuid, text, numeric, text, uuid, uuid, numeric, date, text) to authenticated;
