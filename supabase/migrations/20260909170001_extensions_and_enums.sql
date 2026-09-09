-- 0001 — extensions and enums
--
-- 02-lld.md §2. Enum values cannot be removed from Postgres once created, only
-- added, so this file is the one place where guessing is expensive.
--
-- `owner` is present because D8 is answered yes (docs/decisions.md): John Israel
-- Voola is owner; Suresh K, Prakash R and Meena D are admin. Role assignment and
-- billing-constant edits are owner-only.

create extension if not exists pgcrypto with schema extensions;

create type public.app_role             as enum ('owner', 'admin', 'site', 'client');
create type public.project_status       as enum ('planning', 'active', 'on_hold', 'completed', 'archived');
create type public.package_status       as enum ('not_started', 'design', 'in_progress', 'completed');

-- Four values. The UI's phStatus() computes Pending | Billable | Billed | Paid;
-- `unresolved` maps to "Pending" at the presentation layer in Build 04. Do not
-- rename the enum to match the UI string — the database word is the honest one:
-- a phase whose billability has not yet been resolved.
create type public.phase_billing_status as enum ('unresolved', 'billable', 'billed', 'paid');

create type public.stock_request_status as enum ('pending', 'approved', 'ordered', 'delivered', 'rejected');
create type public.approval_status      as enum ('pending', 'approved', 'rejected');
create type public.approval_type        as enum ('material_sample', 'drawing', 'make_model', 'milestone', 'other');
create type public.bill_status          as enum ('draft', 'submitted', 'certified', 'paid', 'cancelled');
create type public.bill_line_source     as enum ('phase', 'material', 'manual', 'adjustment');
create type public.movement_direction   as enum ('in', 'out', 'adjust');
create type public.attachment_entity    as enum ('approval', 'daily_update', 'bill', 'stock_request', 'project');
create type public.job_status           as enum ('pending', 'running', 'succeeded', 'failed');
