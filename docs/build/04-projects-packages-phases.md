# Build 04 — Projects, Packages & Phases: the Money Hierarchy on Real Data

> **This file is a prompt.** It is the first build that takes a screen off `AppContext` and puts
> it on the database, so it also establishes the migration pattern every later build follows.
>
> **Depends on:** Build 02 (schema, rollup views), Build 03 (session, guards, RBAC).
> **Blocks:** Builds 05–09.
> **Branch:** `build/04-projects-packages`

---

## 0. Prerequisites — what a human must do outside the codebase

- [ ] **Decision D9 answered** — can one client hold several projects? It changes the portfolio
      grouping and the client's navigation. Recommendation is yes.
- [ ] **Real client records.** Legal name, contact person, email, phone, GSTIN and billing
      address for each client Apex currently works with. `clients.gstin` appears on bills.
- [ ] **Real project set for go-live.** For each: code, name, location, client, start date,
      target end date, contract value, and the per-project billing constants if they differ from
      the defaults. Do not invent these — a wrong `gst_rate_pct` on a project silently produces a
      wrong invoice in Build 09.
- [ ] **Package and phase breakdown per project**, with `allocated_amount` (client-facing) and
      `internal_amount` (cost) for each. This is commercially sensitive and probably lives in a
      spreadsheet. Get the actual file; the prototype's figures are illustrative.
- [ ] **Confirm the variance rule.** `01-hld.md` §5.2 deliberately does **not** enforce that
      phases sum to their package total, because real projects hold unallocated contingency.
      Confirm Voola wants the variance *surfaced* rather than *blocked* — this is a visible
      product behaviour, and it is easier to agree now than to argue about after a package shows
      a red number.
- [ ] **Package lead assignment** — which staff member leads which package. Needs the Build 03
      profiles to exist first.
- [ ] Whether **prototype demo data is loaded into production**. It should not be. Production
      starts empty and is populated from the real spreadsheet in Build 10.

---

## 1. Objective

Projects, packages and phases read and write against Postgres, with three genuinely different
role shapes, and the portfolio, dashboard, packages list and package detail pages rendering from
server data — **pixel-identical to tag `proto-v1`**.

---

## 2. Naming: the prototype's vocabulary versus the schema's

The UI and the database use the same words for different things. Get this wrong once and it
propagates through every later build.

| UI (`lib/types.ts`) | Database | Route param | Meaning |
|---|---|---|---|
| `ModuleT` | `packages` | `moduleId` | Swimming Pool, Facade & Windows, MEP |
| `Package` | `phases` | — | A budget line item inside a package |
| `Task` | `tasks` | — | Scheduled work under a phase |
| `m.allocated` / `m.internal` | `packages.allocated_amount` / `.internal_amount` | | |
| `k.alloc` / `k.int` | `phases.allocated_amount` / `.internal_amount` | | |
| `k.billedIn` | `bill_lines.source_id` + `phases.billing_status` | | |
| `k.done` | `phases.manual_complete_at` | | |

**Rename to the schema's vocabulary in the TypeScript layer** as each surface is migrated:
`ModuleT` → `Package`, `Package` → `Phase`. Keep the URL segment `moduleId` for now —
changing it breaks every bookmark and adds nothing — but rename it in a follow-up if Voola wants
the URLs to read correctly. Note the choice in `docs/decisions.md`.

The UI's user-facing labels are unaffected: the Budget tab is still labelled **"Phases"** for
non-admins (`docs/ui-guide.md` §6.5).

---

## 3. The migration pattern this build establishes

Every later feature build repeats these six steps in this order. It comes from
`02-lld.md` §13, and the ordering is not negotiable — retrofitting RLS onto a working UI is how
permission bugs reach production.

1. **Migration + RLS policies** (same file), if the feature needs new SQL.
2. **pgTAP tests for those policies** — before any UI.
3. **`service.ts`** — pure logic, no `next/*`, unit-tested in isolation.
4. **`queries.ts`** — one function per role shape, returning DTOs.
5. **`actions.ts`** — guard, zod parse, delegate, revalidate.
6. **Components** — converted from `useApp()` to props, then a Playwright journey.

---

## 4. Steps

### 4.1 `features/projects/`

**`schema.ts`** — zod for `createProject`, `updateProject`, `setProjectStatus`,
`addProjectMember` (`02-lld.md` §7). `createProject` takes `packages: string[]`, matching the
existing New Project dialog's comma-separated field.

**`service.ts`** — pure. Project code normalisation and validation, the default billing
constants, and the derived portfolio figures. No `next/*` imports; testable against a plain
connection.

**`queries.ts`** — **three separate functions, not one with conditional fields:**

```ts
getPortfolioForAdmin(session)   // allocated, internal, committed, active count
getPortfolioForClient(session)  // contract value, active count, awaiting-approval count
getPortfolioForSite(session)    // active count, packages in progress, pending requests
```

The stat rows differ per role (`docs/ui-guide.md` §6.1), and so does the underlying select list.
A single query with a `role === 'admin' ? …` ternary on the *fields* is exactly the pattern that
leaks a column when someone edits it six months from now. Non-admin queries read the role-scoped
views from migration 0014 and never touch `packages` directly.

**`actions.ts`** — `adminAction` for all four, each ending in
`revalidateTag('project:' + id)` and `revalidatePath('/')`.

`createProject` creates the project **and** its named packages in one RPC or one transaction, so
a failure halfway does not leave a project with two of its four packages.

### 4.2 `features/packages/`

Actions from `02-lld.md` §7: `createPackage`, `updatePackage`, `createPhase`, `updatePhase`.
`markPhaseComplete` is specified here but implemented in Build 05, where the "phase has no tasks"
precondition can actually be tested.

Queries:
```ts
getPackagesForProject(session, projectId)   // dispatches by role to one of three implementations
getPackageDetail(session, projectId, packageId)
getPhasesForPackage(session, packageId)
```

Each admin query reads `v_package_rollup` for committed / remaining / used% / over-budget rather
than recomputing in TypeScript. `lib/logic.ts`'s `committed()` and `totals()` become dead code
once this lands — delete them in the same PR, not "later".

**Optimistic concurrency on `updatePackage`** (`architecture.md` §8.3): the edit form submits the
`updated_at` it loaded with; the action includes it in the `where` clause; zero rows affected
means someone else changed it. Surface it as *"This package was changed by someone else. Reload
to see the current values."* — do not silently overwrite, and do not silently discard.

### 4.3 Money formatting

`lib/money/index.ts`, replacing `fmt` and `fmtS` in `lib/logic.ts`:

```ts
formatINR(123456)         // '₹1,23,456.00'
formatINRCompact(1250000) // '₹12.50 L'
formatINRCompact(15000000)// '₹1.50 Cr'
```

Two behavioural notes:
- The prototype's `fmt()` **rounds to whole rupees** and prints `₹1,23,456`. `02-lld.md` §8.4
  specifies two decimal places. These disagree. Bills must show paise; stat tiles look worse
  with them. **Decision: `formatINR` renders two decimals everywhere except stat tiles, which use
  `formatINRCompact`.** Confirm with Voola, record it, and accept that a handful of table cells
  will gain `.00` versus the prototype. This is the one intentional visual difference in this
  build — list it in the PR.
- Compact form is for stat tiles only. Tables and bills always show full precision.

Server-computed money is passed to components as **both** the raw number and the pre-formatted
string, so the server and the client can never disagree about rounding (`02-lld.md` §8.4).

Unit tests (T-20): Indian digit grouping across 3, 5, 6, 8 and 10-digit values; the L and Cr
thresholds at exactly ₹99,999 / ₹1,00,000 and ₹99,99,999 / ₹1,00,00,000; negatives; zero; null.

### 4.4 Convert the pages

Work one route at a time and keep the app running between each. Establish the pattern on the
portfolio page, then repeat.

**The component contract:** a Server Component fetches via `queries.ts` and passes a DTO into the
existing presentational component as props. The presentational component loses its `useApp()`
call and gains a typed prop. **Its JSX does not change.**

Order:

1. **`app/page.tsx` — All Projects.** Server Component. Role-shaped stat row, `ProjectCard` list.
   `ProjectCard` takes a `ProjectCardData` prop. Add `loading.tsx` with a skeleton matching the
   card grid's dimensions, and `error.tsx`.
2. **`app/projects/[projectId]/page.tsx` — Dashboard.** Stat row (five stats admin / four client
   / three site), packages table, and the three conditional cards. The Pending Approvals,
   Pending Requests and Latest Updates cards still read from `AppContext` at this point — leave
   them, and add a `// TODO(build-07)` / `// TODO(build-08)` comment naming the build file that
   replaces each. A TODO with an owner is a plan; one without is litter.
3. **`app/projects/[projectId]/packages/page.tsx`** — the same table, full width.
4. **`app/projects/[projectId]/packages/[moduleId]/page.tsx`** — header, stat row (none for
   site), and the tab shell. Convert the **Budget/Phases** tab only. Schedule, Updates, Stock and
   Billing tabs stay on `AppContext` until Builds 05–09.
5. **`ModuleTable.tsx` / `PhaseTable.tsx`** — props instead of context. The column sets per role
   (`docs/ui-guide.md` §6.4) come from the DTO's shape, so a site DTO simply has no `internal`
   field and the component cannot render one. Type it so that it *cannot compile* if someone
   tries: three DTO types, a discriminated union on `role`.

**Package tabs become routes** (`02-lld.md` §8.1): `packages/[moduleId]/budget`,
`/schedule`, `/updates`, `/stock`, `/billing`, with `[moduleId]/page.tsx` redirecting to the
default tab for the role. A bookmarked tab then lands correctly, and each tab gets its own
streaming boundary and `loading.tsx`. Keep the tab bar's appearance identical — only the
navigation mechanism changes.

### 4.5 Dialogs to server actions

`AddProjectDialog`, `AddModuleDialog`, `EditModuleDialog`: react-hook-form + the zod schema from
`features/*/schema.ts` (**the same schema object the action parses** — that is the point of
`schema.ts`), submitting to the action.

- Pending state disables the submit button and shows the existing spinner treatment.
- Field errors render inline from the zod result.
- A domain error goes to the existing `Toast`.
- On success: close, revalidate, and navigate exactly as the prototype does (New Project
  navigates to the new project's dashboard).

`EditModuleDialog` gains a hidden `updated_at` field for the optimistic-concurrency check.

### 4.6 Caching and revalidation

Per `architecture.md` §7.4: **no full-route static caching.** Every page here is role-scoped, and
a cached page would serve one role's data to another. Set `dynamic = 'force-dynamic'` on the app
route group, or rely on the fact that `cookies()` access makes them dynamic — but assert it
rather than assume it. A test that a client's rendered HTML never contains a known
`internal_amount` value from the seed is cheap and catches this class of bug.

Tag mutations with `project:{id}` and revalidate that tag from every action.

---

## 5. Tests

**pgTAP**
- A client session reading `v_package_client` gets `allocated_amount` and **no** internal column.
- A site session reading `v_package_site` gets **no money column at all**.
- T-11 re-asserted after this build's changes.

**Unit (Vitest)**
- T-20 money formatting, per §4.3.
- T-16 progress weighting: a 3-week task at 100% and a 1-week task at 0% → **75%**.
- Project progress is allocated-weighted: a ₹40L package at 100% and a ₹2L package at 0% → 95%,
  not 50%.
- `v_package_rollup`'s `committed` counts `approved`, `ordered` and `delivered` only — not
  `pending`, not `rejected`.
- Cost→client factor falls back phase → package → 1.0.

**Integration**
- `updatePackage` with a stale `updated_at` affects zero rows and returns the conflict error.
- `createProject` failing partway leaves no orphaned project.

**Playwright — one journey per role**
- *Admin:* create a project with three packages → add a package with budgets → verify Allocated,
  Internal, Committed, Remaining and Used all render → edit it → verify the change.
- *Client:* open the same project → Packages table shows Allocated and **not** Internal →
  assert the page's HTML source contains no internal figure.
- *Site:* Packages table shows Phases / Open Requests and **no money column**.

**Visual parity**
Screenshot every converted route in three roles × two themes and diff against
`e2e/__screenshots__/proto-v1/`. Expected differences: the `.00` decimals from §4.3, and nothing
else. Any other diff is a regression to fix, not a baseline to update.

---

## 6. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build
```

- [ ] The four converted routes render entirely from the database. Stop the `AppContext` seed
      from loading (temporarily return an empty `AppData`) and confirm those routes still work.
- [ ] `curl` the client-role dashboard HTML and grep for a seeded `internal_amount` value.
      Zero hits. Do the same for the RSC payload, not just the visible HTML.
- [ ] `explain analyze` on the portfolio query with 20 seeded projects: index scans, under 50 ms.
- [ ] Visual diff clean apart from the documented decimal change.
- [ ] `lib/logic.ts`'s `committed`, `totals`, `progress`, `projProgress`, `factor`, `fmt`, `fmtS`
      are deleted, not orphaned.
- [ ] `docs/progress-tracker.md` updated.

---

## 7. Guardrails — do not

- **Do not write one query with role ternaries on its select list.** Three functions, three
  shapes, three tests.
- **Do not fetch `internal_amount` and hide it** in the component, the DTO, or a CSS class. If a
  value would be a permission violation, it must not be in the response body.
- **Do not restyle anything.** The only changes under `components/` are the data source and the
  prop types.
- **Do not enforce that phases sum to the package total** — surface the variance (§0).
- **Do not delete `AppContext` or `lib/data.ts`.** Builds 05–09 still need them. Delete each
  helper in `lib/logic.ts` only when its last caller is gone.
- **Do not add a feature that is not in `01-hld.md` §2.1.**
- **Do not cache a role-scoped page.**

---

## 8. Deliverables

- [ ] `features/projects/` and `features/packages/` — schema, service, queries (three role
      shapes), actions
- [ ] `lib/money/` with T-20 tests; the old formatters deleted
- [ ] Portfolio, dashboard, packages list and package detail (Budget tab) on server data
- [ ] Package tabs converted to routes with per-tab `loading.tsx`
- [ ] Three dialogs on server actions with inline validation and optimistic-concurrency handling
- [ ] Naming migration `ModuleT → Package`, `Package → Phase` in the converted surfaces
- [ ] pgTAP, unit, integration and Playwright tests as listed
- [ ] Visual parity confirmed against `proto-v1`
- [ ] `docs/progress-tracker.md` and `docs/decisions.md` updated
