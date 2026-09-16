# Modularization Report — Apex Dashboard

**Status: executed.** The move described in §2–§5 has been carried out on branch
`refactor/modularize-components` — see `MIGRATION_PLAN.md` for the checklist and verification
results. This document is kept as the rationale and the mapping the migration followed; it now
describes the reasoning behind the current structure rather than a pending proposal.

**Scope:** Assess the current codebase structure and identify what it would take to organize
operations into clean, self-contained modules with better ownership boundaries and access control.

**Headline finding:** this is not a green-field modularization exercise. The domain/business-logic
layer is _already_ modularized by feature, and the boundaries are _already_ machine-enforced by
ESLint, not just convention. The one real gap is that the **UI component layer** was never migrated
to match — it is still organized by component _kind_ (`dialogs/`, `domain/`) instead of by feature,
even though the repo's own documented target layout (`AGENTS.md`) calls for
`features/<domain>/components/`. That gap, and a handful of smaller stragglers, are what this
report recommends closing.

---

## 1. What "module" already means in this repo

Every business domain lives under `features/<domain>/` with a fixed, enforced internal shape:

| File              | Responsibility                                                            |
| ----------------- | ------------------------------------------------------------------------- |
| `schema.ts`       | zod schemas shared by forms and Server Actions                            |
| `queries.ts`      | reads, role-shaped DTOs (never a raw table row to a Client role)          |
| `actions.ts`      | Server Actions — guard → validate → delegate to `service.ts` → revalidate |
| `service.ts`      | pure business logic, **zero** `next/*` imports, unit-testable standalone  |
| `service.test.ts` | unit tests for the above                                                  |

Thirteen modules exist today:

`approvals · attachments · auth · billing · inventory · notifications · ops · packages · projects · schedule · search · stock · updates`

This is a real module system, not just a folder convention — three ESLint rules mechanically
enforce the boundaries (`eslint.config.mjs`):

1. **RLS bypass restriction** — `drizzle-orm`, `@/db`, and `lib/supabase/admin` can only be
   imported from `db/**`, `lib/jobs/handlers/**`, and `lib/auth/admin.ts`. Nothing in a feature
   module or a component can reach the database with a privileged connection.
2. **No framework in `service.ts`** — a module's business logic can't import `next/*` or
   `server-only`, which is what keeps it liftable into a standalone service later (documented
   explicitly in `docs/architecture.md` §14.3 and `docs/01-hld.md` §4.2).
3. **No data layer in components** — components are blocked from importing any
   `features/*/queries`, type-only imports excepted. A component cannot fetch its own data; it can
   only receive props from a Server Component that already called `queries.ts`.

Dependency direction is documented as strictly downward (`app/ → features/ → lib/ → db/`), and
`docs/architecture.md` §4 diagrams it as a precondition for splitting the domain into a separate
service later without a rewrite. This is a stronger form of "modules" than most codebases this
size have — most are relying on convention; here it's a build failure.

**Conclusion for §1:** the backend/domain layer needs no restructuring. It is already the module
system you'd design if starting fresh.

---

## 2. The actual gap: UI components are organized by kind, not by module

`components/` today:

```
components/
├─ ui/          hand-rolled primitives (Button, Card, Badge, Table, …) — intentionally cross-cutting
├─ layout/      Sidebar, Header, SearchBar, NotificationsMenu — intentionally cross-cutting
├─ auth/        SessionProvider, PreviewBanner — intentionally cross-cutting
├─ upload/      FileUploader — intentionally cross-cutting
├─ domain/      18 files, ALL feature-specific, mixed together
└─ dialogs/     19 files, ALL feature-specific, mixed together
```

`components/domain/` and `components/dialogs/` are the problem: every file in them belongs to
exactly one feature module (confirmed by grepping which `@/features/*` each one imports), but they
sit in one flat, shared directory instead of next to the module they belong to. `AGENTS.md`'s own
repository-layout section already documents the intended end state —
`features/<domain>/components/` as a subfolder of each module — but that migration hasn't happened
yet. Right now there is no way to tell, from the directory tree alone, "everything that makes up
the billing module" or "everything that makes up approvals" — you have to open each file and check
its imports, which is exactly the kind of tribal knowledge modules are supposed to remove.

This also matters for the access-control angle in the request: `service.ts` files are the layer
that encodes who can see what (the "only Admin sees margin" rule). When a billing component sits in
a shared `components/domain/` next to an inventory component, there's nothing structurally stopping
someone from copy-pasting a pattern across domains that shouldn't cross — e.g. reusing a
cost-displaying billing widget's code path inside a Site Supervisor-facing screen. Co-locating a
module's components with its `service.ts`/`queries.ts` makes the domain boundary visible at the
filesystem level, not just enforced by import rules.

### Concrete mapping (component → owning module)

Derived by grepping each file's `@/features/*` imports:

| Module                    | `dialogs/`                                                                                           | `domain/`                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **approvals**             | `ApprovalPhotosDialog`, `DecideApprovalDialog`, `NewApprovalDialog`                                  | `ApprovalStatusTabs`, `ApprovalTable`                                                       |
| **billing**               | `BillUploadDialog`, `BillViewDialog`, `CertifyBillDialog`, `RecordPaymentDialog`, `RejectBillDialog` | `BillFiles`, `BillingAdmin`, `BillingClient`, `BudgetStatBar`, `MilestoneTable`             |
| **packages**              | `AddModuleDialog`, `EditModuleDialog`                                                                | `ModuleTable`, `PackageFilterSelect`, `PhaseTable`                                          |
| **schedule**              | `AddTaskDialog`, `TaskDetailDialog`, `NewRequestDialog`*                                             | `Gantt`                                                                                     |
| **stock**                 | `NewRequestDialog`*, `RejectStockRequestDialog`                                                      | `ReqTable`, `StockStatusTabs`                                                               |
| **inventory**             | —                                                                                                    | `InventoryTable`, `InventoryProjectFilterSelect`                                            |
| **updates**               | `EditUpdateDialog`, `PostUpdateDialog`                                                               | `UpdateList`                                                                                |
| **projects**              | `AddProjectDialog`                                                                                   | `ProjectCard`                                                                               |
| **auth / admin**          | `InviteUserDialog`                                                                                   | —                                                                                           |
| **shared (multi-module)** | `DialogHost` (dispatcher, stays shared)                                                              | `StatusBadges` (badges for approvals/billing/inventory/stock), `OpenDialogButton` (generic) |

\* `NewRequestDialog` imports both `@/features/schedule` and `@/features/stock` — it's a single
dialog that creates either a task-material request or a stock request depending on context. It's a
genuine cross-module component and is called out separately in §4.

Everything in the left column of the table (16 of 19 dialogs, 15 of 18 domain components) has a
single, unambiguous owning module and can move mechanically.

---

## 3. Other module-boundary observations

- **`lib/pdf/BillDocument.tsx`** and **`lib/jobs/handlers/bill.pdf.ts`** are billing-domain content
  (RA bill layout, billing PDF generation) sitting in the generic `lib/` tree rather than under
  `features/billing/`. `lib/jobs/handlers/**` is deliberately centralized for a good reason (it's
  the one place allowed to use the `service_role` client — see the ESLint carve-out), so the
  _handler_ should probably stay put. `BillDocument.tsx` itself, however, has no such constraint
  and is a candidate to move to `features/billing/components/`.
- **`context/AppContext.tsx`** is explicitly documented as "prototype state, retired feature by
  feature" — a single global context still holding a `DialogState` union and mutators for whichever
  features haven't been converted to real Server Actions yet. This is intentional migration
  scaffolding (visible in the build history: mutators get deleted from it module by module, e.g.
  billing's were removed in Build 09), not an oversight. It's the one place that's _structurally_
  cross-module by design, and it should keep shrinking as `docs/progress-tracker.md`'s build
  sequence finishes, rather than being tackled directly.
- **`hooks/useLegacyModule.ts`** and **`hooks/useProject.ts`** are transitional shims over the same
  prototype mock data (`lib/data.ts`) that `AppContext` uses, for routes not yet converted. Same
  situation as above — self-documenting, temporary, tracked by the build sequence.
- **`app/(app)/projects/[projectId]/**`** route folders already mirror the module names 1:1
  (`approvals/`, `billing/`, `inventory/`, `packages/`, `schedule/`, `stock/`, `updates/`) and are
  documented as required to stay thin (route params, layout, composition only). This layer is fine
  as-is.

---

## 4. Recommended target layout

```
features/<domain>/
├─ schema.ts
├─ queries.ts
├─ actions.ts
├─ service.ts
├─ service.test.ts
└─ components/          ← NEW: the dialogs/tables/widgets unique to this domain

components/
├─ ui/                   ← unchanged: generic primitives, no business logic
├─ layout/               ← unchanged: app shell
├─ auth/                 ← unchanged: session plumbing
├─ upload/               ← unchanged: generic file upload
└─ shared/                ← NEW home for genuinely cross-module pieces:
    DialogHost.tsx, StatusBadges.tsx, OpenDialogButton.tsx, NewRequestDialog.tsx
```

`StatusBadges.tsx` is the one file worth a design decision rather than a pure move: it currently
holds badge components for four different modules in one file. Splitting it into
`ApprovalStatusBadge`, `BillStatusBadge`, `InventoryStatusBadge`, `StockStatusBadge` and moving each
into its owning module's `components/` folder would finish the job properly; leaving it in
`components/shared/` as one file is the lower-effort fallback.

---

## 5. How to do this without disrupting the active build sequence

The project is mid-flight on a documented build sequence (`docs/progress-tracker.md`; Build 09 —
billing — is the most recently landed, Build 10 is next). Two things follow from that:

1. **Don't do this as one big-bang move.** Move one module's components per PR, same granularity as
   the existing build history, so review stays small and `git blame` stays meaningful.
2. **Order by lowest risk first**, i.e. modules with no pending build work touching their
   components: `projects`, `inventory`, `packages` are safe to move now. `billing` just landed
   (Build 09) — fine to move once its own PR is merged, not concurrently with it. Hold off on
   anything `updates`/`schedule`/`stock` if Build 10 is about to touch their screens — check
   `docs/progress-tracker.md`'s "Still open" table before starting each move.

Suggested sequence:

| Step | Action                                                                                                                                                                                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Create `features/<domain>/components/` for each of the 8 single-owner modules listed in §2's table; `git mv` each component in; fix relative imports.                                                                                                             |
| 2    | Move `NewRequestDialog.tsx`, `DialogHost.tsx`, `OpenDialogButton.tsx` into `components/shared/`.                                                                                                                                                                  |
| 3    | Split `StatusBadges.tsx` per module (optional, higher effort) or move it whole into `components/shared/`.                                                                                                                                                         |
| 4    | Move `lib/pdf/BillDocument.tsx` into `features/billing/components/`.                                                                                                                                                                                              |
| 5    | Add an ESLint rule mirroring `NO_DATA_LAYER`'s pattern that flags new files added to a flat `components/domain/**` or `components/dialogs/**` going forward, so the structure can't silently regress once it's clean.                                             |
| 6    | Leave `context/AppContext.tsx` and the `useLegacyModule`/`useProject` hooks alone — they're already scheduled to shrink to nothing as the build sequence finishes; don't fork effort into migrating scaffolding that's already being retired on its own timeline. |

Each step is a pure file move plus import-path fixes — no behavior change, so it's coverable by the
existing test suite (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) with no new tests
needed.

---

## 6. What this buys you

- **Filesystem-visible ownership**: "what makes up the billing module" becomes `features/billing/`,
  full stop — no more cross-referencing imports to find a domain's UI.
- **Consistent with the repo's own stated target** (`AGENTS.md`'s repository layout already shows
  `features/<domain>/components/` — this closes the gap between documented intent and actual state).
- **Lower risk of cross-domain leakage** in exactly the place `AGENTS.md` cares most about (margin/
  cost visibility): a component can no longer accidentally sit next to, and get copy-pasted from, a
  different domain's component with different access rules.
- **No churn to the parts already right**: `features/*` internals, the ESLint-enforced layering,
  and the route tree under `app/` need no changes — this report only closes one, well-scoped gap.
