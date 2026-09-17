# Database Schema

Generated from `supabase/migrations/*.sql` (the schema source of truth) as of
2026-09-17, with all later `ALTER TABLE` migrations applied. The relationship
diagram is in [er-diagram.md](er-diagram.md).

All tables live in the `public` schema. If this file and the migrations
disagree, the migrations are right.

## Conventions

- **Standard audit columns.** Most business tables carry `created_at`,
  `created_by → profiles`, `updated_at`, `updated_by → profiles` and
  `deleted_at` (soft delete). They are listed as *audit columns* below rather
  than repeated in each table.
- **Tenancy.** Nearly every business table has `org_id → orgs` (not null).
- **ADMIN ONLY** columns are hidden from site and client users by the
  role-scoped views.
- **Money** is `numeric(14,2)`, **quantities** `numeric(14,3)`, **percentages**
  `numeric(6,3)` constrained to 0–100.

## Enums

| Enum | Values |
|---|---|
| `app_role` | owner, admin, site, client |
| `project_status` | planning, active, on_hold, completed, archived |
| `package_status` | not_started, design, in_progress, completed |
| `phase_billing_status` | unresolved, billable, billed, paid |
| `stock_request_status` | pending, approved, ordered, delivered, rejected |
| `approval_status` | pending, approved, rejected |
| `approval_type` | material_sample, drawing, make_model, milestone, other |
| `bill_status` | draft, submitted, certified, paid, cancelled |
| `bill_line_source` | phase, material, manual, adjustment |
| `movement_direction` | in, out, adjust |
| `attachment_entity` | approval, daily_update, bill, stock_request, project |
| `job_status` | pending, running, succeeded, failed |

---

## Organisation and people

### `orgs`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| name | text | not null |
| legal_name | text | |
| gstin | text | |
| pan | text | |
| address | text | |
| logo_r2_key | text | |
| bank_name | text | printed on bill PDF |
| bank_account_no | text | printed on bill PDF |
| bank_ifsc | text | printed on bill PDF |
| created_at | timestamptz | |

### `profiles`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK, FK → `auth.users` (cascade) |
| org_id | uuid | FK → orgs |
| full_name | text | not null |
| email | text | |
| phone | text | |
| role | app_role | default `site` |
| is_active | boolean | default true |
| last_seen_at | timestamptz | |
| created_at, updated_at, deleted_at | timestamptz | |

Constraint: `email` or `phone` must be present.

### `clients`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| name | text | not null |
| contact_person | text | |
| email | text | |
| phone | text | |
| gstin | text | |
| billing_address | text | |
| created_at, updated_at, deleted_at | timestamptz | |

### `rate_limits`

| Column | Type | Notes |
|---|---|---|
| profile_id | uuid | PK, FK → profiles |
| action | text | PK |
| window_start | timestamptz | |
| count | int | |

---

## Projects and work breakdown

### `projects`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| client_id | uuid | FK → clients |
| code | text | unique per org, e.g. `BHEL-NCH` |
| name | text | not null |
| location | text | |
| status | project_status | default `planning` |
| start_date | date | not null |
| target_end_date | date | ≥ start_date |
| completed_at | timestamptz | |
| contract_value | numeric(14,2) | |
| gst_rate_pct | numeric(6,3) | default 18 |
| retention_pct | numeric(6,3) | default 5 |
| mas_billable_pct | numeric(6,3) | default 75 |
| tds_pct | numeric(6,3) | default 0 |
| mobilisation_advance | numeric(14,2) | ≥ 0 |
| mobilisation_recovered | numeric(14,2) | ≥ 0, ≤ advance |
| mobilisation_recovery_pct | numeric(6,3) | default 0 |
| progress_pct | smallint | 0–100, trigger-maintained |
| next_bill_seq | int | bill number counter |
| next_sr_seq | int | stock request counter |
| next_ap_seq | int | approval counter |
| *audit columns* | | |

Constraint: `code` matches `^[A-Z0-9]+(-[A-Z0-9]+)*$`, length 3–20. It is
embedded in every bill number, so it cannot be fixed later.

### `project_members`

| Column | Type | Notes |
|---|---|---|
| project_id | uuid | PK, FK → projects (cascade) |
| profile_id | uuid | PK, FK → profiles (cascade) |
| added_at | timestamptz | |
| added_by | uuid | FK → profiles |

### `packages`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects (cascade) |
| seq_no | int | unique per project |
| name | text | not null |
| lead_profile_id | uuid | FK → profiles |
| allocated_amount | numeric(14,2) | client-facing |
| internal_amount | numeric(14,2) | ADMIN ONLY |
| status | package_status | default `not_started` |
| progress_pct | smallint | 0–100, trigger-maintained |
| *audit columns* | | |

### `phases`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects (cascade) |
| package_id | uuid | FK → packages (cascade) |
| seq_no | int | unique per package |
| name | text | not null |
| allocated_amount | numeric(14,2) | |
| internal_amount | numeric(14,2) | ADMIN ONLY |
| billing_status | phase_billing_status | default `unresolved` |
| manual_complete_at | timestamptz | "Mark Complete" for phases without tasks |
| manual_complete_by | uuid | FK → profiles; set together with `manual_complete_at` |
| *audit columns* | | |

### `tasks`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects; denormalised for RLS |
| package_id | uuid | FK → packages; denormalised for RLS |
| phase_id | uuid | FK → phases (cascade) |
| name | text | not null |
| owner_profile_id | uuid | FK → profiles |
| start_date | date | not null |
| duration_weeks | int | 1–104 |
| end_date | date | generated: `start_date + duration_weeks*7 - 1` |
| progress_pct | smallint | 0–100 |
| note | text | |
| *audit columns* | | |

### `daily_updates`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects (cascade) |
| package_id | uuid | FK → packages |
| update_date | date | default today |
| body | text | not null |
| author_id | uuid | FK → profiles |
| *audit columns* | | |

---

## Inventory and stock

### `units`

| Column | Type | Notes |
|---|---|---|
| code | text | PK |
| label | text | not null |
| sort_order | int | |

### `inventory_items`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects; **null = central store** |
| name | text | not null |
| category | text | |
| sku | text | unique on (org_id, project_id, sku), nulls not distinct |
| unit | text | FK → units |
| qty_on_hand | numeric(14,3) | ≥ 0; cache of `stock_movements` |
| reorder_level | numeric(14,3) | ≥ 0 |
| unit_cost | numeric(14,2) | ≥ 0; never shown to clients |
| location | text | |
| *audit columns* | | |

### `stock_movements`

Append-only ledger.

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| inventory_item_id | uuid | FK → inventory_items |
| project_id | uuid | FK → projects |
| direction | movement_direction | carries the sign |
| qty | numeric(14,3) | always > 0 |
| unit_cost | numeric(14,2) | |
| ref_type | text | `stock_request`, `adjustment`, `transfer` |
| ref_id | uuid | polymorphic, no FK |
| reason | text | |
| created_at | timestamptz | |
| created_by | uuid | FK → profiles |

### `stock_requests`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects (cascade) |
| package_id | uuid | FK → packages |
| phase_id | uuid | FK → phases |
| ref_no | text | unique per org, e.g. `SR-BHEL-NCH-014` |
| inventory_item_id | uuid | FK → inventory_items; null = new material |
| material_name | text | not null |
| qty | numeric(14,3) | > 0 |
| unit | text | FK → units |
| rate | numeric(14,2) | ADMIN ONLY |
| needed_by | date | |
| note | text | |
| status | stock_request_status | default `pending` |
| requested_by | uuid | FK → profiles |
| approved_by / approved_at | uuid / timestamptz | |
| ordered_at | timestamptz | |
| delivered_by / delivered_at | uuid / timestamptz | |
| rejected_reason | text | required when rejected |
| billed_on_bill_id | uuid | bill that MAS-billed it; no FK; prevents double billing |
| *audit columns* | | |

### `stock_request_events`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| request_id | uuid | FK → stock_requests (cascade) |
| from_status | stock_request_status | |
| to_status | stock_request_status | not null |
| actor_id | uuid | FK → profiles |
| note | text | |
| created_at | timestamptz | |

---

## Approvals

### `approvals`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects (cascade) |
| package_id | uuid | FK → packages |
| phase_id | uuid | FK → phases |
| ref_no | text | unique per org, e.g. `AP-BHEL-NCH-007` |
| type | approval_type | |
| item | text | not null |
| note | text | |
| needed_by | date | |
| status | approval_status | default `pending` |
| requested_by | uuid | FK → profiles |
| decided_by | uuid | FK → profiles |
| decided_at | timestamptz | set if and only if status ≠ pending |
| decision_reason | text | required when rejected |
| supersedes_id | uuid | FK → approvals (self) |
| *audit columns* | | |

---

## Billing

### `bills`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects |
| seq_no | int | unique per project |
| bill_no | text | unique per org, `RA-{code}-{n}` |
| bill_date | date | default today |
| period_from, period_to | date | |
| status | bill_status | default `draft` |
| revision | int | default 1 |
| work_value | numeric(14,2) | **A** |
| material_value | numeric(14,2) | **B** |
| gross_amount | numeric(14,2) | **C** = A + B |
| mas_recovery_amount | numeric(14,2) | **D** |
| taxable_amount | numeric(14,2) | **E** = C − D (GST base) |
| gst_amount | numeric(14,2) | **F** = E × GST rate |
| invoice_total | numeric(14,2) | **G** = E + F |
| retention_amount | numeric(14,2) | **H** |
| tds_amount | numeric(14,2) | **I** (informational) |
| advance_recovery | numeric(14,2) | **J** (mobilisation) |
| net_payable | numeric(14,2) | **K** = G − H − I − J |
| gst_rate_pct, retention_pct, tds_pct | numeric(6,3) | snapshotted from project at creation |
| internal_cost_amount | numeric(14,2) | ADMIN ONLY |
| margin_amount | numeric(14,2) | ADMIN ONLY |
| notes | text | |
| idempotency_key | text | |
| created_by | uuid | FK → profiles, not null |
| submitted_at / submitted_by | timestamptz / uuid | |
| certified_at / certified_by | timestamptz / uuid | |
| certification_note | text | |
| paid_at | timestamptz | |
| created_at, updated_at, deleted_at | timestamptz | |

### `bill_lines`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| bill_id | uuid | FK → bills (cascade) |
| source_type | bill_line_source | |
| source_id | uuid | phase_id or stock_request_id; no FK |
| description | text | not null |
| client_value | numeric(14,2) | |
| pct_billed | numeric(6,3) | 100 for phases, `mas_billable_pct` for material |
| amount | numeric(14,2) | client_value × pct / 100 |
| internal_cost | numeric(14,2) | ADMIN ONLY |
| sort_order | int | |
| created_at | timestamptz | |

### `bill_events`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| bill_id | uuid | FK → bills (cascade) |
| from_status | bill_status | |
| to_status | bill_status | not null |
| actor_id | uuid | FK → profiles |
| note | text | |
| created_at | timestamptz | |

### `payments`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| bill_id | uuid | FK → bills |
| amount | numeric(14,2) | > 0 |
| paid_on | date | not null |
| mode | text | `neft`, `cheque`, `upi`, `rtgs` |
| reference_no | text | |
| note | text | |
| idempotency_key | text | |
| created_by | uuid | FK → profiles |
| created_at | timestamptz | |

---

## Files, audit and background jobs

### `attachments`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs |
| project_id | uuid | FK → projects (cascade) |
| entity_type | attachment_entity | |
| entity_id | uuid | polymorphic, no FK |
| r2_key | text | unique |
| thumb_r2_key | text | |
| file_name | text | not null |
| mime_type | text | not null |
| size_bytes | bigint | 1 byte – 25 MB |
| uploaded_by | uuid | FK → profiles |
| created_at, deleted_at | timestamptz | |

### `audit_log`

No foreign keys, so entries survive deletions.

| Column | Type | Notes |
|---|---|---|
| id | bigserial | PK |
| org_id | uuid | not null |
| actor_id | uuid | |
| actor_role | app_role | |
| entity_type | text | not null |
| entity_id | uuid | |
| action | text | `insert`, `update`, `delete`, `transition`, `impersonate` |
| before, after | jsonb | |
| ip | inet | |
| created_at | timestamptz | |

### `jobs`

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| org_id | uuid | FK → orgs, nullable |
| name | text | e.g. `backup.nightly`, `attachment.thumbnail` |
| status | job_status | default `pending` |
| payload | jsonb | default `{}` |
| idempotency_key | text | unique on (name, idempotency_key), nulls not distinct |
| attempts | int | default 0 |
| max_attempts | int | default 5 |
| run_after | timestamptz | |
| lease_until | timestamptz | expiry means the worker died |
| last_error | text | |
| started_at, finished_at, created_at | timestamptz | |

---

## Views

| View | Purpose |
|---|---|
| `v_package_rollup` | package totals and progress |
| `v_phase_billing` | phase billing state |
| `v_inventory_status` | stock levels vs reorder level |
| `v_billable_now` | work and material ready to bill |
| `v_notifications` | notification feed (bills, stock requests, approvals) |
| `v_client_name` | client name lookup |
| `v_package_client`, `v_phase_client`, `v_bill_client`, `v_bill_line_client` | client-safe views, ADMIN ONLY columns removed |
| `v_package_site`, `v_phase_site`, `v_inventory_site`, `v_stock_request_site` | site-user views |
