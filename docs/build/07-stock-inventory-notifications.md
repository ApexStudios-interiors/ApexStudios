# Build 07 — Stock Requests, Inventory Ledger, Notifications & Search

> **This file is a prompt.** It is the first build where a state transition moves stock, so it is
> the first where a race condition costs real money.
>
> **Depends on:** Build 04 (packages), Build 06 (jobs runner, for reconcile).
> **Blocks:** Build 09 — delivered material is half of Billable Now.
> **Branch:** `build/07-stock-and-inventory`

---

## 0. Prerequisites — what a human must do outside the codebase

- [ ] **Opening inventory balances.** A spreadsheet from Apex: item name, category, SKU if any,
      unit, quantity on hand, reorder level, unit cost, location, and which project (or central
      store). This becomes the opening `adjust` movements in Build 10's data migration. Without
      real reorder levels the Low/Critical statuses are meaningless and the notification bell
      cries wolf.
- [ ] **The unit list**, confirmed: `bag`, `sqft`, `nos`, `kg`, `ltr`, `cum`, `rmt`, … Free text
      would produce "Bags", "bags" and "BAG" as three units within a week.
- [ ] **Reference number formats**, confirmed and final. The prototype uses `SR-014`; the LLD
      uses `SR-BHEL-NCH-014` (`02-lld.md` §3.5). These appear in conversations with suppliers and
      cannot be changed after the first one is issued. Decide, and decide whether the counter is
      per-project or per-org. Record as **D18**.
- [ ] **Central store: in or out for v1?** `inventory_items.project_id` is nullable, meaning
      `NULL` = a central store not attached to a project. The UI's business-wide `/inventory`
      view shows a Project column for every row. Confirm whether Apex actually holds central
      stock, and if so, whether transfers between the store and a site are needed — transfers are
      **not** in `01-hld.md` §2.1 and would be new scope. Record as **D19**.
- [ ] **Who marks Delivered**, confirmed: `01-hld.md` §7.1 says Admin or Site. A site supervisor
      marking Delivered creates a stock movement and makes material billable, so this is a site
      user with commercial consequence. Confirm deliberately.
- [ ] **Rate visibility, confirmed.** `stock_requests.rate` is the internal cost per unit and is
      **Admin only**. A site supervisor raising a request does not enter a rate and never sees
      one. Make sure whoever asked for "let Ravi put the price in" understands what that would
      mean for the margin promise.
- [ ] **C2 from the earlier spec: are delivery challans required** for warehouse→site transfers?
      Still unresolved (`01-hld.md` §8.4 item 4). It is a CA/compliance question. It does not
      block this build, but it blocks D19 if transfers are wanted.

---

## 1. Objective

The stock request lifecycle enforced in the database, an append-only movement ledger that is the
truth behind every inventory quantity, both inventory views, the live notifications bell, and the
header search — all on server data.

---

## 2. Steps

### 2.1 Migration: `rpc_transition_stock_request`

Implement `02-lld.md` §5.4 exactly. Read the whole function body there before writing it. The
parts that matter, and why:

1. **`select … for update`** on the request row, first thing in the body. Two supervisors tapping
   "Delivered" at the same instant: the second waits, re-reads `status = 'delivered'`, and fails
   the legality check. Without the lock, stock increments twice and the material is billable
   twice.
2. **Transition legality**, checked in the function, not the UI:
   `pending → approved | rejected`, `approved → ordered`, `ordered → delivered`.
   Everything else raises `ILLEGAL_TRANSITION`. Terminal states are terminal.
3. **Who may do what**: approve / reject / mark-ordered are admin-only; delivered is
   owner/admin/site. `FORBIDDEN` otherwise.
4. **Rejection requires a reason** — `REASON_REQUIRED`. The check constraint enforces it too.
5. **On delivery, inside the same transaction**:
   - create the `inventory_items` row if the request had no linked item,
   - insert a `stock_movements` row with `direction = 'in'`, `ref_type = 'stock_request'`,
   - increment `inventory_items.qty_on_hand`,
   - which together make the item eligible for Billable Now.
6. `stock_request_events` row and `fn_audit(...)` for every transition.

Add a `rpc_create_stock_request` that allocates `ref_no` under the same project row lock used for
bill numbering — a `count(*) + 1` races and produces duplicate reference numbers that are then
sent to suppliers.

**`rpc_adjust_inventory(item_id, new_qty, reason)`** — admin only, reason mandatory. Writes an
`adjust` movement for the delta and updates the cache in the same transaction. Never write
`qty_on_hand` directly from application code (`AGENTS.md` database rule 4).

pgTAP and integration tests before any UI.

### 2.2 `features/stock/`

**`schema.ts`** — `createStockRequest` per `02-lld.md` §7, with `rate` optional.

**`actions.ts`**
- `createStockRequest` — `siteAction`. **Strip `rate` server-side unless the session is
  admin/owner.** Not "ignore it in the form": the field must be removed from the parsed input
  before it reaches the service, so a hand-crafted POST from a site session cannot set a cost.
  Write the test for that specific attack.
- `transitionStockRequest` — thin; the RPC enforces everything. Map its `errcode`s onto the
  `02-lld.md` §10 messages, especially `ILLEGAL_TRANSITION` → *"This request has already moved
  on. Refresh to see the current status."*

**`queries.ts`** — role-shaped. Admin sees `rate` and value; site reads
`v_stock_request_site` with **no money columns**; client sees stock requests not at all
(`01-hld.md` §7.1).

### 2.3 `features/inventory/`

- `getProjectInventory(session, projectId)` and `getBusinessInventory(session, { projectId? })`,
  both over `v_inventory_status` so the Critical / Low / OK status is derived, never stored
  (`01-hld.md` §5.2).
- The stat row — Total Items, Total Value, Low count, Critical count — is computed in SQL, not by
  summing a paginated page in TypeScript.
- `adjustInventory` action wrapping the RPC, admin only.
- **`unit_cost` is admin/site, never client** (`02-lld.md` §3.4). The client has no inventory
  route at all, but the query must still not select it in a shape a client could reach.

### 2.4 `inventory.reconcile`

The job handler stubbed in Build 06. Nightly at 02:00 IST (`30 20 * * *` UTC):

1. For every item, recompute the quantity from `stock_movements`:
   `Σ in − Σ out ± adjust`.
2. Compare with the cached `qty_on_hand`.
3. On any difference: log it, raise a Sentry event, surface it on the ops page, and alert (P2).
4. **Do not silently correct the cache.** A drift means an un-ledgered mutation exists somewhere
   in the code, and overwriting the evidence removes the only signal that the bug is there. The
   `inventory-drift.md` runbook (Build 10) is what fixes it: find the un-ledgered write, post a
   compensating `adjust` movement with a reason, then fix the code path.

T-10 injects a drift and asserts the job detects it.

### 2.5 Convert the surfaces

1. **`app/projects/[projectId]/stock/page.tsx`** — status filter tabs
   (All / Pending / Approved / Ordered / Delivered / Rejected), package filter, and the table from
   `docs/ui-guide.md` §6.9. The **Value** column appears for admin only. Per-row actions follow
   the current status:
   Pending → Approve / Reject (admin) · Approved → Mark Ordered (admin) ·
   Ordered → Mark Delivered (admin or site).
   Buttons are derived from `can()` plus the status, in one place — a helper
   `availableTransitions(status, role)` shared by the row and tested directly.
2. **`packages/[moduleId]/stock/page.tsx`** — the same, scoped, hidden from the client role.
3. **`app/projects/[projectId]/inventory/page.tsx`** and **`app/inventory/page.tsx`** — the same
   table, scoped differently; the business-wide view adds a Project column and a project filter,
   and keeps its **ALL** sidebar tag.
4. **`NewRequestDialog`** — on the server action. Material name keeps its suggestion list, now
   sourced from existing `inventory_items` for the org. The **Rate** field renders for admin only
   *and* is stripped server-side.
5. **`ReqTable`, `InventoryTable`** — props instead of `useApp()`; TanStack Table with
   server-side pagination past 100 rows (`AGENTS.md` conventions).
6. The dashboard's Pending Requests card — the `TODO(build-07)` left by Build 04.

**Reject requires a reason**: the Reject button opens a small confirm dialog with a required
reason field. Do not send an empty reason and let the database refuse it; that produces a generic
error where a field-level message belongs.

### 2.6 Notifications

Replace `buildNotifications()` in `lib/logic.ts` with a query over `v_notifications`
(`02-lld.md` §4.4), filtered by `auth_role() = any(for_roles)` and by project membership.

- Scoped across **all** projects the user can access, not the current one (`01-hld.md` §11).
- **No read state, no notifications table.** The notification *is* the work item; it disappears
  when the work is done (ADR-014). Do not add "mark as read" — it would create a state that can
  disagree with reality.
- The bell badge count and the dropdown come from one query. Revalidate on the mutations that
  change it.
- Each entry links to the relevant project's relevant page, as now.

Confirm the role mapping matches `01-hld.md` §11 exactly:
admin/owner → pending requests + submitted bills + low/critical inventory;
site → pending requests + low/critical inventory;
client → pending approvals + submitted bills.
The prototype's `buildNotifications` gives site users submitted bills as well — that is a bug in
the prototype (site sees no bills at all), and the view is correct. Note the fix in the PR.

### 2.7 Header search

`components/layout/SearchBar.tsx` currently calls `buildSearchResults()` over the in-memory
dataset. It has no counterpart in the LLD's API surface — specify it now rather than leaving it
on seed data.

Add `searchAll({ query })` as an `authedAction`:

- Searches projects, packages, stock requests, approvals, bills, inventory and users — **each
  through the role-scoped query for that entity**, so scoping is inherited rather than
  reimplemented. A client searching "marble" must not learn that a stock request exists.
- Minimum two characters; debounced client-side; capped at five results per category and 25
  overall.
- Use Postgres `ilike` with a trigram index (`pg_trgm`) on the searched text columns. Add the
  extension and the indexes in a migration in this build. Full-text search is not warranted at
  this data size.
- Rate-limit it. It is an unauthenticated-feeling input that runs seven queries.

Add `searchAll` to `02-lld.md` §7 — the API surface should describe everything that exists.

---

## 3. Tests

**pgTAP**
- A site session selecting `stock_requests.rate` returns nothing or errors.
- A site session reading `v_stock_request_site` gets rows with no money column.
- A client session selecting anything from `stock_requests` or `inventory_items` returns nothing.
- No role can insert into `stock_movements` directly (T-14a, re-asserted).

**Integration — the concurrency tests are the point of this build**
| ID | Assertion |
|---|---|
| T-06 | **Two concurrent `delivered` transitions increment stock exactly once.** Run both in parallel transactions; one succeeds, one raises `ILLEGAL_TRANSITION`; `qty_on_hand` moved by exactly one delivery |
| T-07 | `pending → delivered` raises `ILLEGAL_TRANSITION` |
| T-08 | Reject with no reason raises `REASON_REQUIRED` |
| T-09 | An adjustment that would make `qty_on_hand` negative is rejected |
| T-10 | The reconcile job detects an injected drift between cache and ledger, and does not silently fix it |
| — | A site session's `createStockRequest` carrying a `rate` in the payload stores `rate = null` |
| — | Delivery of a request with no `inventory_item_id` creates the item, the movement and the cache update in one transaction; a forced failure rolls back all three |
| — | Two concurrent `createStockRequest` calls produce distinct `ref_no` values |
| — | An admin transitioning a request on a project they are not a member of is refused |

**Unit**
- `availableTransitions(status, role)` for all five statuses × four roles — twenty cases, all
  asserted.
- Inventory status thresholds at exactly `qty = 0`, `qty = reorder_level - 0.001`,
  `qty = reorder_level`.

**Playwright**
- *Site:* raise a request (no Rate field visible in the DOM) → admin approves → admin marks
  Ordered → site marks Delivered → inventory quantity increases → the item appears in Billable
  Now (assert via the admin session).
- *Admin:* reject without a reason → blocked with a field error, not a toast.
- *Client:* `/projects/{id}/stock` is forbidden; the sidebar has no Stock Requests entry.
- *Bell:* a pending request appears for admin and site, and not for the client.

---

## 4. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build
```

- [ ] T-06 run at least 50 times in a loop without a single double-increment. A concurrency test
      that passes once has proven nothing.
- [ ] Grep a site session's RSC payload for a seeded `rate` value. Zero hits.
- [ ] `explain analyze` on the business-wide inventory query with 5,000 items: index scans.
- [ ] The reconcile job, run against a deliberately corrupted cache, produces an alert and leaves
      the cache untouched.
- [ ] The bell shows the same counts as the underlying pages, across projects, for each role.
- [ ] Visual parity against `proto-v1` for all four converted routes, both themes.
- [ ] D18 and D19 recorded; `searchAll` added to `02-lld.md` §7.
- [ ] `docs/progress-tracker.md` updated.

---

## 5. Guardrails — do not

- **Do not update `inventory_items.qty_on_hand` from application code.** RPC only, with the
  movement row in the same transaction.
- **Do not add an update or delete path to `stock_movements`.** Corrections are compensating
  `adjust` rows with a reason (ADR-007).
- **Do not let the reconcile job auto-correct a drift.** Alert; a human follows the runbook.
- **Do not send `rate` to a non-admin**, and do not accept it from one.
- **Do not implement transitions in the UI.** The RPC decides; the UI reflects.
- **Do not add "mark notification as read"** or a notifications table (ADR-014).
- **Do not add a status column for inventory.** It is derived (`v_inventory_status`).
- **Do not add warehouses, transfers, purchase orders or GRNs.** Out of scope (`01-hld.md` §2.2);
  the schema is designed so they can be added later without rework.

---

## 6. Deliverables

- [ ] `rpc_transition_stock_request`, `rpc_create_stock_request`, `rpc_adjust_inventory`
- [ ] `features/stock/` and `features/inventory/` with role-shaped queries
- [ ] `inventory.reconcile` handler with alerting and no auto-correction
- [ ] Stock and inventory routes (project, package, business-wide) on server data
- [ ] `NewRequestDialog` with server-side rate stripping; reject-with-reason dialog
- [ ] Notifications from `v_notifications`, cross-project, role-scoped, no read state
- [ ] `searchAll` action with `pg_trgm` indexes, per-entity role scoping and rate limiting
- [ ] Tests T-06 through T-10 plus the unit, pgTAP and Playwright sets
- [ ] `02-lld.md` §7 amended with `searchAll`; D18, D19 recorded
