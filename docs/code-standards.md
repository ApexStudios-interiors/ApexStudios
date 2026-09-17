# Code Standards

Concrete conventions for this repository. `../AGENTS.md` holds the hard rules; this holds the
detail that would otherwise be re-litigated in every review.

Anything here that contradicts `../AGENTS.md` is wrong and should be fixed here.

---

## 1. Layering

```
app/            Route segments. Params, layout, composition. Thin.
features/<d>/   schema.ts · service.ts · queries.ts · actions.ts · components/
components/ui/  Primitives. No business logic. No data fetching.
lib/            supabase · r2 · jobs · rbac · money · pdf · xlsx · observability · env
db/             Drizzle schema + generated types
```

**Dependency direction is strictly downward.** Nothing depends on `app/`.

| File | Must | Must not |
|---|---|---|
| `service.ts` | Be pure, testable against a plain connection | Import `next/*` or `server-only` |
| `actions.ts` | Guard → parse → delegate → revalidate | Contain business arithmetic |
| `queries.ts` | Return role-shaped DTOs | Be called from a Client Component |
| `components/` | Take props | Query the database, or know what a role is |
| `components/ui/` | Stay generic | Contain domain logic or be restyled |

These are enforced by ESLint (`build/01-foundations.md` §3.11). A rule that only lives in a
document is a rule that erodes.

**Why this matters beyond tidiness:** `01-hld.md` §4.2 keeps the option of lifting the domain
into a standalone service if a mobile app or a third-party integration ever needs one. That
option exists only while `service.ts` is framework-free.

---

## 2. TypeScript

- **Strict mode**, plus `noUncheckedIndexedAccess`. **No `any`. No `!`.** Narrow properly.
- **Types derive from the schema.** Drizzle types and zod inference — never a hand-written
  interface duplicating a table.
- **Server-only modules start with `import 'server-only'`** — every `queries.ts`, `actions.ts`,
  and everything in `lib/supabase/`, `lib/r2/`, `lib/jobs/`.
- Prefer `type` over `interface` unless declaration merging is genuinely wanted.
- Discriminated unions over optional-field soup. A role-shaped DTO is three types and a union,
  not one type with six optional fields — that way a site DTO **cannot compile** with a money
  field on it.
- Name things as the domain does: `packages` are packages, `phases` are phases. The prototype's
  `ModuleT` is a package; rename as each surface is migrated (`build/04` §2).

```ts
// Good — the type system carries the permission boundary
type PackageRow =
  | { role: 'admin';  allocated: number; internal: number; committed: number }
  | { role: 'client'; allocated: number }
  | { role: 'site';   phaseCount: number; openRequests: number };

// Bad — one shape, optional money, one careless edit from a leak
type PackageRow = { allocated?: number; internal?: number; … };
```

---

## 3. React and Next.js

- **Server Components by default.** `"use client"` only on genuinely interactive leaves: dialogs,
  filters, the Gantt bars, the theme toggle, the uploader.
- One component per file, colocated under its owning feature. Shared primitives in
  `components/ui/`.
- **Never fetch in a Client Component.** Data comes from `queries.ts` through a Server Component
  and arrives as props.
- Every route segment gets `loading.tsx` with a skeleton that reserves the real layout's
  dimensions, and `error.tsx` showing the `request_id`.
- **No role-scoped page is cached.** A cached page would serve one role's data to another
  (`architecture.md` §7.4). Revalidate with `revalidateTag('project:{id}')` after mutations.
- **Optimistic UI only where it earns its complexity**: task progress. Never money, never a
  status transition.
- No `dangerouslySetInnerHTML`. Anywhere. Daily update bodies render as plain text with CSS
  line-break preservation.

---

## 4. Forms and actions

```ts
// features/<domain>/schema.ts — one schema, shared by the form and the action
export const createPackageSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(120),
  allocatedAmount: z.coerce.number().nonnegative(),
  internalAmount: z.coerce.number().nonnegative(),
});

// features/<domain>/actions.ts
export const createPackage = adminAction
  .schema(createPackageSchema)
  .action(async ({ parsedInput, ctx }) => {
    await requireProjectAccess(ctx.session, parsedInput.projectId);
    const pkg = await packageService.create(parsedInput, ctx.session);
    revalidateTag(`project:${parsedInput.projectId}`);
    return pkg;
  });
```

- **The form and the action parse the same schema object.** That is the entire reason `schema.ts`
  exists as a separate file.
- Guarded action clients are the default (`adminAction`, `siteAction`, `clientAction`,
  `ownerAction`). Bare `actionClient` is for login only.
- Field errors render inline. Domain errors go to the toast.
- Submit buttons disable while pending; forms are never double-submittable. Money-moving actions
  (`createBill`, `recordPayment`) also carry a client-generated idempotency key.
- **Strip privileged fields server-side**, never by omitting them from the form. A site user's
  `createStockRequest` payload containing `rate` must be stripped in the action, and there must be
  a test proving it.

---

## 5. SQL and migrations

Naming (`02-lld.md` §1.1): tables `snake_case` plural · views `v_*` · role-scoped views
`v_{subject}_{role}` · functions `fn_*` · callable RPCs `rpc_*` · triggers `trg_{table}_{event}` ·
indexes `idx_{table}_{columns}`.

Every migration that creates a table, in the same file:

```sql
create table public.thing ( … );

alter table public.thing enable row level security;
alter table public.thing force  row level security;

create policy thing_select on public.thing for select to authenticated
  using ( deleted_at is null and public.is_member_of(project_id) );

create index idx_thing_project on public.thing(project_id) where deleted_at is null;
```

Non-negotiable:
- Money `numeric(14,2)`, quantity `numeric(14,3)`, percentage `numeric(6,3)`, progress
  `smallint`. **Never `float`, `real`, `double precision` or `money`.**
- Every column named in a policy is indexed.
- Every `security definer` function sets `search_path = ''`. Without it, a caller can shadow a
  table name and escalate privileges.
- Soft delete only (`deleted_at`). Every query filters `deleted_at is null`.
- `stock_movements`, `audit_log` and `bill_events` are append-only for **every** role including
  `owner`. Corrections are compensating rows.
- Money and stock mutations take a row lock (`select … for update`) and re-check state inside the
  RPC. Never application-level read-modify-write.
- Forward-only, and compatible with the previous code version. Breaking changes go
  **expand → migrate → contract**.

Comment a view with the columns it deliberately omits and why:

```sql
-- v_package_client: omits internal_amount, committed, remaining, used_pct, margin.
-- Adding any of them is a client-visible margin leak. 01-hld.md §7 Layer 2.
```

---

## 6. Money

- **Always `formatINR()` / `formatINRCompact()`** from `lib/money`. Never an inline
  `toLocaleString` — there is a lint rule.
- Indian digit grouping. Compact `L` / `Cr` on stat tiles only; full precision in tables and on
  every bill.
- **Arithmetic never uses JavaScript numbers.** Postgres `numeric` is authoritative for anything
  stored; `decimal.js` for previews in the browser; a test asserts the two agree to the paisa.
- Money is passed from server to component as **both** the raw value and the pre-formatted
  string, so the two sides can never disagree about rounding.
- Rounding is half-up to two decimals **at the point of storage**, never at display.

---

## 7. Styling

- **Strict monochrome.** Colour is reserved exclusively for status meaning: the six badge
  variants in `ui-guide.md` §10 — green success, amber warning, red destructive, solid default,
  flat gray secondary, bordered outline.
- **No brand colour, no accent, no coloured button.**
- Tailwind utilities only. No CSS modules, no styled-components, no inline `style` beyond
  computed positions (the Gantt bars).
- Theme tokens from `globals.css`. Never a raw hex in a component.
- **Light and dark are both checked on every UI change.** Not one of them.
- Mobile-first for the transactional surfaces (daily updates, stock requests, task progress,
  approvals) — a supervisor uses these on a phone on site. Desktop-first for the analytical ones
  (billing, portfolio, inventory).
- Wide tables scroll inside their own container. The page body never scrolls horizontally.

---

## 8. Errors and logging

Domain errors are typed and mapped at the action boundary (`02-lld.md` §10):

| Code | User message |
|---|---|
| `UNAUTHENTICATED` | "Your session expired. Please sign in again." |
| `FORBIDDEN` | "You don't have permission to do that." |
| `NOT_FOUND` | "That record no longer exists." |
| `ILLEGAL_TRANSITION` | "This request has already moved on. Refresh to see the current status." |
| `ALREADY_BILLED` | "One or more items are already on another bill." |
| `NEGATIVE_STOCK` | "Not enough stock on hand." |
| `REASON_REQUIRED` | "Please give a reason." |
| `VALIDATION` | Field-level messages from zod |

- **A raw Postgres error never reaches the browser.** They carry table names, column names and
  sometimes values.
- Unmapped exceptions become a generic message, logged server-side with the `request_id` shown
  to the user so support can find the log line. There is no error-tracking service (D49).
- **Structured logs carry `request_id`, `user_id`, `role`, `route`, `duration_ms` — and never a
  monetary value or a personal name** (`architecture.md` §6.4). Any error payload leaving the
  process carries the same. There is a redaction filter and it has a test.
- To debug with real numbers, reproduce locally against seed data.

---

## 9. Tests

- **Unit** (Vitest) — pure services. Billing at 100% branch coverage.
- **Database** (pgTAP) — every policy, every role, from a **client SDK session**. Never the SQL
  editor.
- **Integration** (Vitest + a hosted Supabase project — the linked dev project, or the PR's
  preview branch in CI; there is no local stack, D14) — RPCs, concurrency, illegal transitions. Concurrency
  tests run in a loop; passing once proves nothing.
- **E2E** (Playwright) — the three role journeys, with saved storage state per role.
- **Visual** (Playwright snapshots) — badge colours, light and dark, the Gantt.

Conventions:
- Name tests by the assertion, not the function: `"a client session cannot select internal_amount"`.
- Reference the test matrix id where one exists: `it('T-01: GST is computed on taxable, before retention', …)`.
- Fixed seed UUIDs, so tests reference rows by id rather than by position.
- No `.only`, no `.skip`, nothing marked flaky — least of all in the RLS suite.
- A test that asserts a permission is denied must sit beside one asserting the corresponding
  permission is granted. A suite of only negative assertions passes against a database nobody
  can read.

---

## 10. Comments

Comment the **why**, never the what. The valuable comments in this codebase are the ones that
stop a future reader from "fixing" something deliberate:

```ts
// GST is charged on the taxable value BEFORE retention is deducted. Under Indian GST,
// retention money is part of the value of the supply. See 01-hld.md §8.4. Do not reorder.
```

```sql
-- Cancelled bills hard-delete their lines. This is the one deliberate exception to soft
-- delete: it frees idx_bill_lines_source so the items return to Billable Now. 02-lld.md §3.8.
```

Every deviation from a design document gets a comment naming the document and the reason.
`TODO`s name the build file that resolves them: `// TODO(build-09): replace with real bill data`.
A TODO without an owner is litter.
