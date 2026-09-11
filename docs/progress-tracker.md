# Progress Tracker

Updated by the agent at the end of every build file. One row per numbered step.

Legend: ✅ done and verified · 🟡 done, but something is unverified or deferred ·
⛔ blocked on someone · ⬜ not started

---

## Build 01 — Foundations

Branch `build/01-foundations`. Opened as PR #1, CI green (see the run log below).
**Merged into `main` via PR #2's squash**, not its own: `build/02-database` was branched from
`build/01-foundations` before #1 was merged separately, so #2's squash carried this branch's
full content into `main` in one commit. PR #1 was closed unmerged as redundant rather than
merged on top, which would have been a no-op. Baseline tag `proto-v1` at commit `e52d6cc`.

| Step | Status | Notes |
|---|---|---|
| 3.1 Docs consolidated into `docs/` | ✅ | `ARCHITECTURE.md` → `architecture.md` casing fixed (breaks on Linux CI); `AGENTS.md` refs inside `docs/` now `../AGENTS.md`; `UI-GUIDE.md` → `docs/ui-guide.md`; mockup → `docs/reference/`. A mirror copy is kept at `../context-all/` at Voola's request. |
| 3.2 Decision register | ✅ | `docs/decisions.md`, sixteen entries, all answered 2026-09-09. Two carry an open CA confirmation. |
| 3.3 `AGENTS.md` reconciled | ✅ | Next 16, React 19, hand-rolled primitives, root layout, D11 rule, documentation map. `architecture.md` §4 and §16, `01-hld.md` §18 amended in the same commit. |
| 3.4 Migrate to pnpm | ✅ | pnpm 12.3.4 pinned via `packageManager`; `pnpm-lock.yaml` in, `package-lock.json` out; `.npmrc` `engine-strict`; `engines.node >= 20`. Install scripts allowlisted in `pnpm-workspace.yaml` with a reason each. |
| 3.5 Directory scaffold | ✅ | Root layout per D13. `.gitkeep` in empty folders, no stub `service.ts`. |
| 3.6 Dependency set | ✅ | All groups installed. **`next-safe-action` 8.7.3 works on Next 16** — verified by a real browser round-trip, not a typecheck. **`sharp` 0.35.4 loads and renders locally** (libvips 8.18.6). |
| 3.7 Strict TypeScript | ✅ | `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. 58 errors fixed. **All 16 non-null assertions removed** — no `!`, no `any` anywhere. |
| 3.8 Validated environment | ✅ | `lib/env.ts`, `lib/env.client.ts`, `.env.example`, `pnpm env:check`. `.gitignore` no longer swallows `.env.example`. |
| 3.9 Supabase | 🟡 | `supabase init` done; `config.toml` committed with `jwt_expiry = 1800` and `enable_signup = false`, ready for `supabase config push`. **D14 removed Docker and the local stack**: scripts now target the linked hosted project. `pnpm db:link` / `db:push` unverified — the Supabase projects do not exist yet. |
| 3.10 Drizzle | ✅ | `drizzle.config.ts` + `pnpm db:check-drift`. Passes as a no-op until Build 02 adds `db/schema`. |
| 3.11 Architecture lint rules | ✅ | Six rule groups, each commented with its source rule. **Proved by deliberate violation, then reverted.** Patterns are composed so a narrower block cannot silently disable the D11 rule. |
| 3.12 Test harness | ✅ | Vitest with 100% branch gate on `features/billing/**` and `lib/money/**`; Playwright with three role projects. `pnpm test:rls` exits non-zero on an empty suite. 20 tests pass. |
| 3.13 Sentry | 🟡 | Config written by hand (the wizard needs a DSN that does not exist). **Redaction filter and its 11 tests are done and passing.** Inert until the Sentry org exists. |
| 3.14 Health endpoint | ✅ | `GET /api/health`. Returns 503 `{db:false,r2:false}` on placeholder credentials, which is correct. Leaks no configuration. |
| 3.15 CI pipeline | ✅ | `.github/workflows/ci.yml`: install, typecheck, lint, format, unit tests, build, gitleaks, `pnpm audit`. Dependabot weekly. **Green on PR #1** (run 34372991215, all three jobs). First run failed on a gitleaks 403, not a finding — the job needed `pull-requests: read`; fixed and re-run. |
| 3.16 Vercel project | ⛔ | `vercel.json` pins `bom1`, no `crons` array (Build 06 adds it). **Linking and env vars need a Vercel account.** |
| 3.17 Freeze the prototype | ✅ | Tag `proto-v1`; `docs/reference/prototype-dataset.ts`; **60 baseline screenshots** in `e2e/__screenshots__/proto-v1/`, three roles × two themes, captured against a production build. |
| 3.18 Progress tracker | ✅ | This file. |
| D14 Docker removed (post-plan) | ✅ | Decided 2026-09-09 mid-build. Local stack dropped; scripts, docs, CI and both env templates now target hosted projects. `pnpm db:reset` and `pnpm test:rls` refuse to run against `SUPABASE_PROD_PROJECT_REF`. |

### Verification run

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | ✅ |
| `pnpm typecheck` | ✅ zero errors, strict, no `any`, no `!` |
| `pnpm lint` | ✅ zero errors, `--max-warnings 0` |
| `pnpm format:check` | ✅ (repo normalised once, in this build) |
| `pnpm test` | ✅ 20 passed |
| `pnpm build` | ✅ |
| `pnpm env:check` | ✅ passes; fails naming the key when one is deleted |
| Visual parity vs `proto-v1` | ✅ 60/60 screenshots identical after the strictness refactor **and** after the formatting pass |
| Lint catches a deliberate violation | ✅ `next/*` in a service, Drizzle in a service, `queries` in a component, `toLocaleString`, `localStorage`, `service_role` in a component — all six fire |
| `pnpm db:link && pnpm db:push` | ⛔ no Supabase project to link (D14 removed the Docker alternative) |
| `curl /api/health` → 200 | 🟡 returns 503, correctly, on placeholder credentials |
| Green CI run | ✅ PR #1, run 34372991215 |
| Vercel preview | ⛔ no Vercel account |

---

## Resolved since the plan

| Was blocking | Resolved |
|---|---|
| Repository was public | Now **private**. Branch protection on `main` still to configure. |
| Nothing pushed, no CI evidence | Branch and tag `proto-v1` pushed; **PR #1 open with CI green**. |
| Git identity unset | Set to Kiranmai Duggirala &lt;app.voola@gmail.com&gt;. |
| Docker Desktop not running | No longer relevant — **D14 removed Docker entirely**. |

## Open blockers

| Blocker | Blocks | Owner | Raised |
|---|---|---|---|
| Branch protection on `main` not configured (require CI green, require one review) | Merge safety | Voola | 2026-09-09 |
| **No Supabase org or projects** (`apex-prod`, `apex-dev`, ap-south-1), no Pro upgrade, no preview branching. **D14 makes this the critical path**: with no local database, Build 02 cannot start at all until `apex-dev` exists. | Build 02 onward | Voola | 2026-09-09 |
| No Vercel team/project, no Pro, region `bom1` unset | Preview deploys, Build 06 cron | Voola | 2026-09-09 |
| No Cloudflare R2 buckets or the two separate API tokens | Build 06 files | Voola | 2026-09-09 |
| No Sentry org, DSN or auth token | Observability, source maps | Voola | 2026-09-09 |
| No domain `app.beapex.in`, no transactional email provider | Build 03 client magic links | Voola | 2026-09-09 |
| `sharp` unverified on the Vercel Node runtime (needs a deployment) | Build 06 thumbnails | Voola | 2026-09-09 |
| CA confirmation: material-at-site as secured advance (D4) | First real bill | Voola → CA | 2026-09-09 |
| CA confirmation: statutory retention period (A-5) | Build 10 R2 lifecycle rules | Voola → CA | 2026-09-09 |
| CA sign-off: the five tax questions in `01-hld.md` §8.4 | Build 09 go-live | Voola → CA | 2026-09-09 |
| DPDP Act 2023 obligation set from counsel | Launch | Voola → counsel | 2026-09-09 |
| Apex Studios legal details for bill headers (legal name, GSTIN, PAN, address, bank, logo) | Build 09 | Voola | 2026-09-09 |
| Real staff list (name, email, phone, role) | Build 03 | Voola | 2026-09-09 |

---

---

## Build 02 — Database

Branch `build/02-database`. **Verified end to end against `apex-dev`** as of 2026-09-10.
Sixteen migrations applied, D15 spike PASSED, seeded, 28/28 pgTAP assertions pass, 18/18
integration tests pass, drift check clean.

| Step | Status | Notes |
|---|---|---|
| 2 Spike (definer view under `force` RLS) | ✅ | **PASS.** `v_spike_client` returned the row; `spike_costs` returned none to the same client session. Migration 0014 needs no design change. Recorded as D15. |
| 3 / 4.1–4.7 Migrations 0001–0016 | ✅ | All sixteen applied to `apex-dev`. Two real bugs found only by running them, both fixed in the migration files and patched onto the live dev database directly rather than via a follow-up migration, since nothing downstream depends on these unmerged files yet: `stock_requests`/`approvals`/`daily_updates` were missing the standard `created_by`/`updated_by` pair from `02-lld.md` §1.3; `rpc_finish_job`'s `status` assignment used an untyped `CASE`, which Postgres resolves to `text` before the enum assignment, only failing at call time, not at `create function` time. |
| 4.8 Drizzle schema and types | 🟡 | `db/schema/*` mirrors the migrations; `db/index.ts` carries the D11 rule. `db:types` needs a database. |
| 4.9 Seed | ✅ / 🟡 | Applied cleanly to `apex-dev`. One bug: `AP-002`'s `approval_type` was seeded as `'material'`, which is not a value of that enum (`'material_sample'` is) — fixed. **Org legal identity on hold**, tracked by `pnpm check:release`, correctly not blocking anything else. |
| 4.10 CI database stages | ✅ | Migrations, seed, pgTAP, integration, drift, all now exercised locally and passing. `psql` and `supabase test db` both replaced — see findings below. |
| 5.1 pgTAP policy suite | ✅ | 14/14 pass. |
| 5.2 Structural pgTAP | ✅ | 6/6 pass. |
| 5.3 Integration tests | ✅ | 18/18 pass, across four files (jobs, constraints, rollup, drift). Three genuine test bugs found and fixed — see below. |
| 5.4 Seed invariants | ✅ | 8/8 pass. The placeholder assertion was removed from this suite — it duplicated, and conflicted with, the deliberate soft-hold design in `pnpm check:release` (see below). |

### What was found by actually running it, that drafting alone could not catch

| Finding | Where |
|---|---|
| **`supabase test db` needs Docker unconditionally**, even against a remote `--db-url` — its own `--help` lists a `--network-id` flag, the tell that it always shells out to a container. Direct conflict with D14. Replaced with `scripts/run-pgtap.mjs`, which runs each test file through the project's own `postgres` driver and parses pgTAP's `finish()` output as plain TAP text — no Docker, no new dependency. | `scripts/run-pgtap.mjs` |
| **`psql` is not guaranteed to exist** on a developer machine — it did not exist in the environment this was first run in. `scripts/db-seed.mjs` replaces the `psql -f seed.sql` call with the same `postgres` driver already a project dependency. | `scripts/db-seed.mjs` |
| **The legal-identity placeholder check existed in two places** — the blocking pgTAP suite and the soft `check:release` script — after being moved to the latter last session. Left in pgTAP it defeated the entire point of the move: a hard-fail assertion for a business decision on hold. Removed from pgTAP, with a comment explaining why it isn't there. | `supabase/tests/02_seed_invariants_test.sql` |
| **Two schema bugs surfaced only by running the migrations**, not by reading them: `stock_requests`, `approvals` and `daily_updates` were missing the standard `created_by`/`updated_by` audit pair `02-lld.md` §1.3 requires of every business table; `rpc_finish_job`'s enum assignment used an untyped `CASE`, which plpgsql does not catch at `create function` time. | migrations 0007, 0008, 0009, 0012 |
| **Three integration-test bugs**, also only visible under a real connection: two concurrency tests inserted many rows sharing one `(name, null idempotency_key)`, which collided with the very uniqueness guarantee `jobs_idem_uq` provides (`nulls not distinct`); the generated-column test compared a JS `Date`'s locale `toString()` against an ISO substring, which fails depending on the runner's timezone even when the actual date is correct. | `tests/integration/jobs.test.ts`, `constraints.test.ts` |
| **The pooler's hostname is per-project, not derivable from the project ref or a region guess** — `aws-0-<region>` is not a reliable pattern; connecting needs the exact host from the dashboard's Connect panel. | environment setup |
| **`apex-dev` is in ap-northeast-1 (Tokyo), not ap-south-1 (Mumbai)** as `architecture.md` §5.1 specifies. Recorded as D18. Not blocking Build 02; will cost real latency once Build 04 adds per-page queries against a Mumbai-region Vercel deployment. | D18 |
| **Project code is now constrained, not just conventional.** `BHEL-NCH` confirmed; `projects_code_ck` enforces upper-case alphanumeric groups, 3–20 characters. A typo at project creation is permanent, because it is already in the bill numbers by the time anyone notices. | migration 0004, D16 |
| **The unit list became a lookup table.** Nine confirmed codes, referenced by both `inventory_items.unit` and `stock_requests.unit`. Free text over a closed vocabulary lets `bag` and `bags` become two materials that never reconcile, in a table whose quantity feeds a bill. Deviates from `02-lld.md` §3.4, which is amended in the same PR. | migration 0006, D17 |
| **RA-001's transcribed total was wrong.** The prototype's two lines sum to ₹89,877.75, not the ₹1,19,837 first written. Caught by recomputing rather than trusting the transcription; the corrected net matches the prototype's own displayed ₹1,01,562. | `supabase/seed.sql` |
| **The prototype's margin uses a magic number.** `billTotals()` computes cost as `Σ lineCost − round(recovery × 0.6)`. That 0.6 appears nowhere in the HLD or LLD, and it is why the prototype shows RA-002's margin as ₹2,28,210 where `taxable − internal_cost` gives ₹1,56,308. Build 09 has to decide what recovery does to margin. | `lib/logic.ts`, seed comment |
| **`projects.start_date` is NOT NULL, but a quoted project has no start date.** The prototype's second project has `start: null`. Seeded with the quote date and flagged for Build 04. | `02-lld.md` §3.2 |
| **Two prototype tasks belong to no phase**, but `tasks.phase_id` is NOT NULL. Attached to the phase they obviously belong to, with a comment. | `supabase/seed.sql` |
| **The prototype has only three of five stock-request statuses** and three of four bill statuses. Two requests and two bills added so Builds 07 and 09 have every state to develop against. | `supabase/seed.sql` |
| **ESLint flat config caught my own violations**: 25 non-null assertions in the tests I wrote, and the D11 rule blocked the drift test's legitimate schema import. Fixed properly rather than exempted, apart from one narrow, reasoned exemption for `tests/integration/**`. | — |

### Still open

| Needed | Blocks |
|---|---|
| **Apex Studios' legal identity**: legal name, GSTIN, PAN, registered address — **ON HOLD at Voola's request, 2026-09-10** | The `orgs` seed row. Reported by `pnpm check:release` and a hard gate on production deploy; deliberately not a failing unit test |
| **Region mismatch (D18)**: `apex-dev` is in Tokyo, not Mumbai | Build 04 latency; recommend recreating before then |
| Default billing constants confirmed as defaults (18 / 5 / 75 / 0 assumed) | New-project defaults only |
| `apex-prod` project, Pro upgrade, preview branching | Later builds |

## Build 03 — Auth and RBAC
Not started. Needs the transactional email provider for client magic links.

## Builds 04–10
Not started.


---

## Build 03 — Authentication, Session, RBAC & User Administration

Branch `build/03-auth-and-rbac`. **Verified end to end**: real password sign-in for staff, a
real magic-link-equivalent sign-in for the client role (no SMTP needed for this, see below),
all three Playwright login journeys passing against `apex-dev` from a real production build,
38/38 pgTAP, 18/18 integration tests, 42/42 unit tests, typecheck/lint/format/build all clean.

### What shipped

| Area | Status | Notes |
|---|---|---|
| Custom access token hook | 🟡 | Function created and applied (migration 0017). **Not registered with GoTrue** — that needs `supabase config push`, which needs `SUPABASE_ACCESS_TOKEN` (see Build 02's carried-forward blocker). `config.toml` is correctly configured and ready to push the moment that token exists. Until then, `auth_role()`/`auth_org()` fall back to a table read on every request — slower, not insecure, exactly as designed. |
| `lib/supabase/{server,client,admin}.ts` | ✅ | Import restriction proven to fire against a real page. |
| `middleware.ts` | ✅ | Session refresh, request id, unauthenticated redirect. Deliberately no authorization logic. |
| `lib/auth/session.ts` | ✅ | `getSession`/`requireSession`/`requireRole`/`requireProjectAccess`. Role/org read from the JWT claim first, table fallback second — matching `auth_role()`'s own coalesce order, so the app layer and RLS are never inconsistently stale. |
| `lib/rbac/{roles,permissions,nav}.ts` | ✅ | `CAN` ties to `01-hld.md` §7.1 with a row-for-row test. `nav.ts` replaces `lib/nav.ts`; `ALLOWED_SECTIONS` is now derived, not duplicated. |
| `lib/safe-action.ts` | ✅ | Five guarded clients, full `02-lld.md` §10 error mapping. |
| `(auth)` route group | ✅ | Staff login (+TOTP challenge step), client magic link, callback (handles both `?code=` and `?token_hash=&type=`), error page, logout. |
| Route restructuring | ✅ | Introduced `app/(app)/` and `app/(auth)/` — a real structural change, not optional: auth screens cannot share a shell built for a signed-in session. URLs unchanged; a mechanical `git mv`. |
| `SessionProvider`, Sidebar real identity | ✅ | Real name/role/initials. "Switch role" replaced by "Preview as" (owner/admin) + "Sign out". |
| Impersonation (D20) | ✅ | Signed, 15-minute httpOnly cookie; `rpc_log_impersonation` audits start/stop and re-checks `is_admin()` server-side; persistent non-dismissible banner. Read-shaping only — `requireRole` never consults it, by construction, so a write path cannot be fooled by it. |
| `app/(app)/forbidden.tsx`, `error.tsx` | ✅ | `next.config.ts` needed `experimental.authInterrupts: true` for `forbidden()` to work at all — off by default in Next 16. |
| User administration | ⛔ | **Not built this pass.** `features/users/actions.ts` (invite/setRole/deactivate/membership) and `lib/auth/admin.ts` are not written. Scoped out to keep this already-large build shippable; tracked below as the first item for the next session. |
| Tests | 🟡 | pgTAP (hook + is_admin/is_member_of edge cases) and unit (CAN-vs-HLD) done. Integration: T-15 (role revocation) and the orphan-cleanup/owner-only assertions from §3.2 not yet written — same reason as user administration above. Playwright: all three real login journeys, plus an unauthenticated-access spec, both passing. |

### Real bugs found only by actually signing in

| Finding | Where |
|---|---|
| **Seeded `auth.users` rows failed every sign-in** with a generic 500 ("Database error querying schema"), not an invalid-credentials error. Cause: `confirmation_token`, `recovery_token`, `email_change` and `email_change_token_new` were `NULL` — fine by the column's schema, fatal to GoTrue's own login query, which expects `''`. Invisible from `admin.createUser()` (which sets these correctly) and invisible from reading the seed SQL; only surfaced by actually trying to sign in. Fixed live on `apex-dev` and in `supabase/seed.sql`. | `supabase/seed.sql` |
| **The Supabase client generic's `Database` type silently collapsed queries to `never`** without `Relationships: []` on every table/view — `GenericTable`/`GenericView` require it, and TypeScript's failure mode here is total, not a clear error at the missing field. | `scripts/gen-types.mjs` |
| **A fourth D14 (no-Docker) conflict**: `supabase gen types typescript` also shells out to Docker unconditionally, even with `--db-url`. Extended the same introspection-based generator pattern from Build 02 to also emit real `Functions` signatures (needed once `rpc_log_impersonation` existed to call). | `scripts/gen-types.mjs` |
| **Admin-generated magic links use GoTrue's implicit flow** (tokens in a URL fragment), which a server-side route can never see — fragments never leave the browser. The fix generalizes past the test: `/auth/callback` now accepts Supabase's `token_hash`+`type` verification shape alongside `?code=`, which is the documented, no-fragment alternative — real users benefit too, not just the Playwright fixture. | `app/(auth)/auth/callback/route.ts` |
| **ESLint's `no-restricted-imports` pattern-matched `@/db` as a prefix**, not an exact string — a narrow carve-out for the connection-free generated type file didn't work as written. Resolved by moving the file to `lib/supabase/database.types.ts`, architecturally cleaner anyway since nothing in `db/` ever needed it. | `eslint.config.mjs`, `lib/supabase/database.types.ts` |
| **`components/ui/DialogShell.tsx`'s `Field` never associated its label with its input** (no `htmlFor`/`id`) — invisible until a real accessibility-driven test (`getByLabel`) needed to find the field. Added as an optional, backward-compatible prop. | `components/ui/DialogShell.tsx` |
| **Widening `Role` to include `owner`** would have silently broken `isMoney`/`canApprove` and four other exact `role === "admin"` checks across the existing prototype code, hiding financial data from a real owner session. Audited every `role ===` site in the codebase before widening the type; fixed each one found. | `lib/logic.ts`, `components/layout/Sidebar.tsx`, `components/domain/ReqTable.tsx` |

### A stated scope deviation, not a silent one

`app/(app)/projects/[projectId]/layout.tsx` does **not** call `requireProjectAccess` yet, though
build/03 §2.8 step 4 asks for it. The URL's `projectId` is still the **mock** AppContext id
("bhel"), not a real database row — Build 04 hasn't migrated this route's data source yet.
Wiring the real membership check now would 403 every site/client session on every project route,
since "bhel" never matches an actual `projects` row. The session-presence check is real; the
membership check is deferred to land together with Build 04's real project ids. Recorded in the
file itself, not just here.

**Resolved in Build 04**: `requireProjectAccess` is now wired into that layout.

### Decisions

D19 (phone OTP: deferred) and D20 (impersonation: build it) both recorded, answered.

### Still open going into Build 04

| Item | Blocks |
|---|---|
| `features/users/actions.ts`, `lib/auth/admin.ts` — user administration | The `app/(app)/users` page still runs on `AppContext` mocks |
| T-15 and the remaining §3.2 integration assertions | Full confidence in role-revocation and orphan-cleanup |
| `SUPABASE_ACCESS_TOKEN` — still needed to actually register the hook, and for any future `config push` | The hook staying on its (safe, slower) fallback path indefinitely |
| Per-IP/per-email rate-limit refinement beyond Supabase's project-level limits | Nothing blocking; a stated refinement |
| `requireProjectAccess` real enforcement | Arrives with Build 04's project id migration |

---

## Build 04 — Projects, Packages & Phases

Branch `build/04-projects-packages`. **Verified end to end**: real admin create/edit/read
journeys against `apex-dev` from a real production build (Playwright, all three roles), 60/60
visual-baseline screenshots passing against `proto-v1` (documented differences only), 39/39
pgTAP, 26/26 integration tests, 60/60 unit tests, typecheck/lint/build all clean.

### What shipped

| Area | Status | Notes |
|---|---|---|
| `features/projects/{schema,service,queries,actions}.ts` | ✅ | Three role-shaped portfolio/dashboard query functions, `createProject` (atomic via `rpc_create_project`), `updateProject`, `setProjectStatus`, `addProjectMember`, plus `getClientOptions` for the New Project dialog. |
| `features/packages/{schema,service,queries,actions}.ts` | ✅ | `getPackagesForProject`/`getPackageDetail`/`getPhasesForPackage`, each three role-shaped implementations, not one query with a role ternary. `createPackage`, `updatePackage` (optimistic concurrency on `updated_at`), `createPhase`, `updatePhase`, plus `getStaffOptions`/`getPackageForEdit` for the dialogs. |
| Portfolio, dashboard, packages list, package-detail Budget tab | ✅ | Real Server Components. `ModuleTable`, `PhaseTable`, `ProjectCard`, `BudgetStatBar` take props, discriminated on `role`, instead of `useApp()`. |
| Package tabs → routes | ✅ | `packages/[moduleId]/{budget,schedule,updates,stock,billing}`, shared header/stat-row/tab-bar in `layout.tsx`, `[moduleId]/page.tsx` redirects to `/budget`. Schedule, Updates, Stock and Billing stay on `AppContext` (`LegacyModuleTab`/`useLegacyModule` pattern) until Builds 05–09. |
| `AddProjectDialog`, `AddModuleDialog`, `EditModuleDialog` | ✅ | react-hook-form + the same zod schema the action parses. Gained fields the mock system never needed: a Project Code input, and real Client/Lead dropdowns fetched from the database instead of hard-coded names. |
| Missing `v_phase_site` view, `v_client_name` view | ✅ | New migrations — see Decisions below. |
| `lib/money`, `formatINR`/`formatINRCompact` | ✅ | Wired into every converted component; the sanctioned `.00` visual diff. |
| `lib/logic.ts` cleanup | ✅ | `committed`, `totals`, `projProgress` deleted (all three reached zero callers after conversion). `progress`, `factor`, `fmt`, `fmtS` kept — still load-bearing for Schedule/Billing/Inventory and the not-yet-converted package tabs. The build file's instruction to delete all seven was checked against actual callers, not followed literally. |
| Tests | ✅ | pgTAP: `v_phase_site`/`v_phase_client` column omission, `v_client_name` shape, both re-asserting T-11. Unit: T-16 (both the task-duration and the package-allocation weighting), `v_package_rollup.committed`'s status filter, `fn_cost_to_client_factor`'s fallback chain — all as pure oracles for the SQL. Integration: real client-SDK sessions (not pgTAP) proving `v_package_client`/`v_phase_client`/`v_phase_site` actually return rows with the right columns for each role. Playwright: one full journey per role, admin's exercising real create/edit through the real UI. |

### Real bugs found only by actually running it

| Finding | Where |
|---|---|
| **`v_phase_client` and `v_phase_site` returned zero rows for every non-admin session, always**, since Build 02. Both joined `v_phase_billing`, which is deliberately `security_invoker = on`; reached through another (definer) view, that join re-evaluates RLS as the original caller, who has no `SELECT` on `phases`/`tasks` at all. Fixed by computing `is_complete` inline against `tasks`, the same pattern `v_package_site` already used. | `supabase/migrations/20260910180004_fix_phase_role_views.sql`, D21 |
| **PostgREST serializes `numeric` and `int8` as JSON numbers, not strings** — the type generator assumed both are always strings, copying `postgres.js`'s own (correct, for that driver) behaviour. | `scripts/gen-types.mjs`, D21 |
| **Any soft delete through the Supabase client fails RLS** on a table whose `SELECT` policy filters `deleted_at is null` (nearly every table) — PostgREST always executes `UPDATE ... RETURNING`, and Postgres enforces the `SELECT` policy against the post-write row. No build has shipped a soft-delete action yet, so nothing depends on this today. | D21 |
| **Every Supabase client read was silently eligible for Next.js's fetch cache.** A project created by a Server Action, then read on the very next request, came back "not found" — reproducible only inside Next.js. Fixed with an explicit `cache: "no-store"` fetch override. Could have been silently affecting every read since Build 03. | `lib/supabase/server.ts`, D22 |
| **`ProjectShell.tsx`'s existence check and `LegacyDashboardCards`' `useProject()` call both crashed for any project without a mock-data entry** — which is every project the real `createProject` action creates, permanently. Fixed alongside wiring in the real `requireProjectAccess` check Build 03 had deferred to this build. | `app/(app)/projects/[projectId]/{layout,ProjectShell}.tsx`, `LegacyDashboardCards.tsx`, D22 |
| **A native `<select>`'s "unassigned" option submits `""`, and `z.uuid().optional()` rejects it outright** — failed at client-side validation, silently, before either dialog's submit handler ran. | `features/packages/schema.ts`, D22 |
| **No TOTP enrollment UI exists, and `requireAalForRole` hard-requires AAL2 for owner/admin unconditionally** — every `adminAction`-guarded Server Action was unreachable by the seeded admin account. Dev-only fix in `e2e/global-setup.ts`; the real enrollment UI remains an open gap (D22, "Still open" table in `docs/decisions.md`). | `e2e/global-setup.ts`, `e2e/totp.ts`, D22 |
| **The portfolio's project ordering was nondeterministic.** `supabase/seed.sql`'s multi-row `INSERT` gives every row the identical `now()` for `created_at` (Postgres evaluates it once per statement), so `order by created_at` had nothing to break the tie with — reordered by `start_date`, a real distinct value. | `features/projects/queries.ts` |
| **The prototype's "To assign" placeholder for an unset package lead was rendered unconditionally**; the real query returned `null` and the component omitted the line entirely — a real, if minor, visual diff caught by the `proto-v1` baseline. | `features/packages/queries.ts`, `components/domain/ModuleTable.tsx` |

### Decisions

D21 (schema/view findings) and D22 (this build's runtime findings) both recorded. Neither is a
question anyone was asked — both are findings.

### Still open going into Build 05

| Item | Blocks |
|---|---|
| TOTP enrollment UI (D22) | A real admin/owner account cannot use any admin-gated action today |
| Schedule, Updates, Stock, Billing package tabs — still `AppContext` | Builds 05–09, in that order per the build sequence |
| `markPhaseComplete` | Deferred to Build 05, where the "phase has no tasks" precondition can be tested |
| A vendor-name lead (e.g. "Laxmi Multi Services" in the prototype) has no real representation — `lead_profile_id` only points at staff profiles | Cosmetic; not blocking |

## Build 05 — Schedule, Tasks, the Gantt on Real Dates & Progress Rollup

Branch `build/05-schedule`. **Verified end to end**: real task CRUD and progress journeys against
`apex-dev` from a real production build (Playwright, all three roles), 66/66 visual-baseline
screenshots passing against `proto-v1` (documented differences only, one new route baselined),
46/46 pgTAP, 37/37 integration tests, 81/81 unit tests (including under `TZ=America/New_York`),
typecheck/lint/build all clean. Full `--workers=1` e2e run (matching CI): 84 passed, 24 skipped
(role-inapplicable routes), 0 failed.

### What shipped

| Area | Status | Notes |
|---|---|---|
| `rpc_set_task_progress`, `rpc_mark_phase_complete` | ✅ | Both `security definer`, row-locking, membership+role checks, never-reopen-billed/paid logic, `fn_audit` calls. `rpc_mark_phase_complete`'s Server Action and UI wiring are Build 09's, per this build's own deliverables list — the RPC and its tests ship now. |
| `features/schedule/{schema,service,queries,actions}.ts` | ✅ | Real date arithmetic (`weekIndex`, `taskEndDate`, `dateAtWeek`, `isLate`, `viewportWeeks`, `monthHeaders`, `weightedProgress`), all pure and unit-tested. `getScheduleForProject`/`getScheduleForPackage` role-branch to `v_package_site`/`v_phase_site` for non-admin. `createTask`, `updateTask`, `setTaskProgress` (all `siteAction`), plus `getOwnerOptions`/`getPhaseOptions`/`getTaskForEdit`. |
| `Gantt.tsx` rewrite | ✅ | Real dates and a scrolling viewport instead of a fixed 14-column grid; role-unaware (`canEdit` prop only). A real, pre-existing (since Build 01) stacking bug was found and fixed in the same file — see below. |
| `AddTaskDialog`, `TaskDetailDialog` | ✅ | Real Phase/Owner dropdowns (FKs, not free text). `TaskDetailDialog`'s progress slider is this build's one `useOptimistic` use: instant visual update, commit-on-release, automatic revert on failure. |
| Schedule surfaces → routes | ✅ | `projects/[projectId]/schedule` (all packages, collapsible cards) and the new `packages/[moduleId]/schedule` route, both real Server Components now. |
| `lib/logic.ts`/`lib/data.ts`/`lib/types.ts` cleanup | ✅ | `progress()` deleted (zero remaining callers post-conversion). `Task`'s mock `w`/`d` fields removed; `p`/`pkg` kept (MilestoneTable's Billing tab still reads them until Build 09). |
| Tests | ✅ | pgTAP: both RPCs `security definer` and not anon-executable, `tasks`' select policy shape, the ancestry trigger's own `security definer` fix. Unit: every build-file-specified date-arithmetic edge case, 21 tests, timezone-independent. Integration: T-17, never-reopen-billed, refusals, and a direct D24 regression test. Playwright: one journey per role (below). |

### Real bugs found only by actually running it

| Finding | Where |
|---|---|
| **A site user could never create a task, ever, since Build 02.** `trg_tasks_check_ancestry` read the admin-only `phases` table under plain `SECURITY INVOKER`, so its own lookup returned nothing under RLS for any non-admin caller, raising a false "phase does not exist" for a phase the caller was a real member of. Fixed by making the trigger `SECURITY DEFINER` — it validates a structural invariant with values the client doesn't control, so bypassing RLS for this one internal check is correct. | `supabase/migrations/20260911090002_fix_tasks_ancestry_trigger.sql`, D24 |
| **`createTask`, and separately `getScheduleForProject`/`getScheduleForPackage`, crashed or returned empty for site/client** — both queried the admin-only base tables `packages`/`phases` directly. The same root cause as Build 04's `v_phase_client` finding, rediscovered twice more in this build alone: an incidental lookup against an admin-only table, inside a code path a non-admin role can reach, silently fails under RLS. Fixed by routing through `v_package_site`/`v_phase_site`. | `features/schedule/{actions,queries}.ts` |
| **Every week-cell in a Gantt row is `position: relative` (unchanged since Build 01), so a multi-week task bar's own overflow past its first week was visually correct but painted BELOW later cells in the same row** — same-level positioned siblings stack by DOM order, and later weeks come later in the DOM. Two consequences: every multi-week bar was clickable only in its first ~one-week segment (confirmed via `elementFromPoint`, not a screenshot — the overflow rendered correctly, it just didn't receive the click), and the "today" column's grey highlight painted a visible grey patch into any bar crossing it. Fixed with a `z-10` on just the bar's own starting cell. Predates Build 05 entirely; found only because this build's own Playwright journeys are the first to actually click a multi-week bar. | `components/domain/Gantt.tsx`, D25 |
| **A stale visual baseline, unrelated to any Build 05 code**: `project-dashboard`/`project-packages`/`package-detail` showed the Swimming Pool package's progress as 14% against a database that has always (since Build 02's seed) computed 16% for its current task data (verified by hand against the rollup trigger's own formula: `round((2×100+3×100)/32) = 16`). Refreshed rather than treated as a regression. | D25 |

### Decisions

D23 (this build's four prerequisite confirmations), D24 (the ancestry-trigger finding) and D25
(three visual-baseline findings, two accepted-as-correct and one real fix) all recorded.

### Still open going into Build 06

| Item | Blocks |
|---|---|
| TOTP enrollment UI (D22) | A real admin/owner account cannot use any admin-gated action today |
| Updates, Stock, Billing package tabs — still `AppContext` | Builds 06–09, in that order per the build sequence |
| `rpc_mark_phase_complete`'s Server Action and UI (the Billing tab's "Mark Complete" button) | Build 09 |
| The build file's own Playwright spec item "...and the phase shows as Billable in the Billing tab" is not verifiable yet — that tab is still mock data. T-17 (the RPC's actual billing_status flip) is covered directly against the database in `tests/integration/schedule.test.ts` instead. | Build 09 |
| Every seeded task has `owner_profile_id is null` — the prototype's owner values (vendor/gang names like "Sai Waterproofing", role placeholders like "Client") have no real profile to point at, the same class of gap as Build 04's package-lead finding. Renders correctly as "To assign". | Cosmetic; not blocking |
| No existing schedule (MS Project/Excel) was provided to import (D23's own open item) — Build 05 proceeded on the documented assumption that tasks are entered by hand | Build 10's task importer, only if a real file surfaces |

## Build 06 — File Storage, the Background Job Runner & Daily Updates

Branch `build/06-files-and-jobs`. **No real Cloudflare R2 account, Vercel Pro, or CRON_SECRET
exist yet** (still Build 01's fake-but-valid-shaped local placeholders) — proceeded per Voola's
own instruction: write and fully test everything that doesn't need live R2/Vercel, and report the
rest as unverified. **Verified**: 60/60 pgTAP (14 new), 48/48 integration tests (11 new,
`tests/integration/files-and-jobs.test.ts`), 100/100 unit tests, 66/66 visual-baseline screenshots
(documented differences only), typecheck/lint/build all clean, `--workers=1` e2e green. Manually
verified live against `apex-dev`: the full Daily Updates write path (post with a photo attempt,
photo fails against fake R2 with an inline Retry, text still posts), every `/api/cron/[job]` route
(401 without/with-wrong `CRON_SECRET`, 404 for an unknown job name, 200 with a real summary for
each of `jobs.drain`/`jobs.reap`/`inventory.reconcile`/`weekly.maintenance`/`backup.verify`, each
R2-touching one failing exactly as expected against fake credentials), and the Admin Failed Jobs
page (list + Retry, both against a real failed row).

### What shipped

| Area | Status | Notes |
|---|---|---|
| `rpc_enqueue_job`, `rpc_retry_job` | ✅ | New RPCs alongside Build 02's `rpc_claim_jobs`/`rpc_finish_job`. Enqueue is an authenticated-callable allowlist (`attachment.thumbnail` only, for now); retry is admin-only and resets `attempts` to 0, not just `status` — a "retry" at `max_attempts` that can't actually retry isn't one. |
| `projects.completed_at` | ✅ | New trigger-maintained column (migration 0025) — `project.archive`'s "closed > 12 months" needs a real transition timestamp; `updated_at` would let an unrelated later edit push the archive date out. |
| `lib/r2/{constraints,keys,client,presign,head}.ts` | ✅ | Pure key builder and sanitizer (path traversal, unicode, length, double-extension — all unit-tested), presign (5-min PUT / 15-min GET TTL), HeadObject wrapped as a discriminated result. |
| `lib/jobs/{enqueue,registry,runner}.ts` + handlers | ✅ | `runner.ts` needed the same service_role carve-out as `lib/jobs/handlers/**` (ESLint's own restriction, widened with a documented reason) — `rpc_claim_jobs`/`rpc_finish_job` are service_role-only, and a cron invocation has no Supabase session for `rpc_enqueue_job`'s path to work with anyway. `attachment.thumbnail`, `attachment.orphan_sweep`, `project.archive`, `backup.verify` all real; `inventory.reconcile` a documented stub (Build 07). |
| `app/api/cron/[job]/route.ts` | ✅ | One route serves five cron entries. Bearer auth before anything else, unknown name is 404, claim/dispatch/record only — no real work in the handler. |
| `features/attachments/` | ✅ | `requestUploadUrl`/`confirmUpload` take an explicit `projectId` (a documented deviation from the build file's own shorthand — a daily update's photos upload before the update row exists, so there's nothing yet to derive a project from), `getDownloadUrl`, `getThumbnailUrl`. |
| `FileUploader.tsx` | ✅ | Per-file request→PUT→confirm, 3 concurrent, inline per-file retry, the rest of the form still submits on a failure. Its internal queue is one self-recursive function, not two mutually-referencing `useCallback`s — the latter tripped the React Compiler's own hooks/refs lint twice over (temporal-dead-zone access, then a ref write during render) before landing on this shape. |
| `features/updates/` + three real surfaces | ✅ | `postDailyUpdate` (client-generated id, carried through the upload flow), `editDailyUpdate` (24-hour window enforced in RLS, not just the action), `getUpdatesForProject` (keyset-paginated, role-branched package lookup). Project-level, package-level, and the dashboard's Latest Updates card all real now. |
| Admin Failed Jobs page | ✅ | `app/(app)/ops/jobs/`, admin-only (`requireRole` throws, not a hidden nav link), list + Retry via `rpc_retry_job`. |
| `backup.nightly` (D17/D26) | ✅ | A GitHub Actions workflow, not Vercel — real `pg_dump`, uploaded with a backup-scoped credential, outcome reported to the same `jobs` table via `POST /api/backup/report`. `backup.verify` (a real Vercel cron, independent) asserts a real object exists. Neither has run for real yet — no R2 account. |
| Tests | ✅ | pgTAP: both new RPCs' grants/security, `attachments`/`daily_updates` policy shapes. Unit: `sanitizeFilename`'s every edge case, `canEditUpdate`'s boundary. Integration: real-session enqueue/retry, the reaper's own query, cross-project `attachments` RLS, the 24-hour edit window at the RLS layer. Playwright: the achievable half of both photo-upload journeys (resilience, not the live-thumbnail happy path), the client button-absence journey. |

### Real bugs and gaps found only by actually running it

| Finding | Where |
|---|---|
| **The type generator excluded every service_role-only RPC**, on the premise that only the RLS-scoped client ever calls one — true until this build's `runner.ts` needed to call `rpc_claim_jobs`/`rpc_finish_job` through the admin client. Widened to include functions granted to `authenticated` OR `service_role`. | `scripts/gen-types.mjs` |
| **The prototype's package badge lost its "01 " number prefix** converting `UpdateList` to real data — `mno()`'s own convention, dropped in the first pass and caught by the `proto-v1` baseline. | `features/updates/queries.ts`, `components/domain/UpdateList.tsx`, D27 |
| **No seeded `daily_update` has a matching `attachments` row** — the prototype's photo counts (2–6 per entry) have nothing real behind them; there was no upload pipeline when they were seeded, and no real R2 bucket yet to backfill them against. Renders correctly as an empty photo grid. | D27 |
| **`FileUploader`'s upload queue tripped the React Compiler's hooks/refs lint twice**: first for two `useCallback`s referencing each other before both were declared (a real temporal-dead-zone risk, not just a style complaint), then for a "keep a ref pointed at the latest callback" fix that itself violated a separate "no ref writes during render" rule. Resolved by making the queue one self-recursive function instead of two mutually-referencing ones — no forward reference, nothing else to trip on. | `components/upload/FileUploader.tsx` |

### Decisions

D26 (backup location — the build file's own text calls it "D17", already taken by the inventory
unit vocabulary; recorded under the next free number with a cross-reference) and D27 (the two
Daily Updates visual-baseline findings) both recorded, alongside the R2/Vercel-not-provisioned
confirmation.

### Still open going into Build 07

| Item | Blocks |
|---|---|
| **No real Cloudflare R2 account** (three buckets, CORS, two scoped tokens, lifecycle rules) | Every live upload-pipeline check; Build 08 (approval photos); Build 09 (bill PDFs) |
| **Vercel not on Pro** | The real per-minute `jobs.drain` |
| `CRON_SECRET` and the R2 env vars are still local placeholders | Both rows above |
| `inventory.reconcile` is a documented no-op stub | Build 07 fills it in |
| `bill.pdf` isn't in `lib/jobs/registry.ts` yet (no code enqueues it) | Build 09 adds it, and its own name to `rpc_enqueue_job`'s allowlist |
| TOTP enrollment UI (D22) | A real admin/owner account cannot use any admin-gated action today |

## Build 07 — Stock Requests, Inventory Ledger, Notifications & Search

Branch `build/07-stock-and-inventory`. Not yet merged; not yet opened as a PR.

**Verified**: 131/131 unit tests, 84/84 pgTAP (21 new, across `06_stock_inventory_test.sql`,
`07_notifications_test.sql` and `08_search_test.sql`), 65/65 integration tests (18 new, across
`stock-and-inventory.test.ts` and `notifications.test.ts`), typecheck/lint/build all clean. The
full three-role Playwright journey (`e2e/stock-inventory-journey.spec.ts`) passes: raise → approve
→ order → deliver → inventory increases → appears in `v_billable_now`, admin's reject-without-reason
blocked with a field error, client forbidden from `/projects/{id}/stock` with no sidebar entry, and
the bell showing the right rows to admin/site and nothing to client. Visual-parity checked against
`proto-v1` for all four converted routes, both themes — differences found are documented below, not
silently accepted. All new RPCs and views smoke-tested live against `apex-dev` from real signed-in
sessions (not service_role). The dev database was left exactly seed-consistent after every check —
`rpc_inventory_drift()` reports 0 rows as of the last verification pass.

### What shipped

| Area | Status | Notes |
|---|---|---|
| `rpc_create_stock_request`, `rpc_transition_stock_request`, `rpc_adjust_inventory` | ✅ | The full lifecycle (pending → approved/rejected → ordered → delivered) with row-lock concurrency safety, rate stripped for non-admin at both the action layer (real role, never impersonated) and the RPC itself, atomic delivery → inventory-item-creation → ledger movement → cache update in one transaction. Fixed a real bug in 02-lld.md §5.4's own pseudocode along the way (before/after audit state captured in the wrong order). |
| `rpc_inventory_stats`, `rpc_inventory_drift` | ✅ | Stats is `security invoker` (aggregates only already-visible rows); drift is `security definer`, service_role-only, one indexed aggregate comparing the cache against `Σ in − Σ out` per item. |
| `lib/jobs/handlers/inventory.reconcile.ts` | ✅ | Replaces Build 06's stub. Logs, raises a Sentry message, and throws — landing the job in `failed` is the alert. Deliberately never auto-corrects the cache. Verified live: an injected un-ledgered mutation is detected and the cache is left untouched. |
| `features/stock/`, `features/inventory/` | ✅ | service/schema/actions/queries for both, role-scoped views throughout (`v_stock_request_site`, `v_inventory_site`, `v_inventory_status`), the established literal-`.from()`-per-branch pattern. |
| `features/notifications/` | ✅ | Replaces `buildNotifications()` in `lib/logic.ts`. One query over `v_notifications`, filtered by `.contains("for_roles", [effectiveRole])`, scoped across every project the session can access via each underlying table's own RLS. Wired into `app/(app)/layout.tsx` → `Header` → `NotificationsMenu` as a server-fetched prop, no client-side data fetching. No read state, no notifications table (ADR-014). |
| `features/search/` | ✅ | `searchAll` (`authedAction`), one role-scoped query per entity (projects/packages/stock requests/approvals/bills/inventory/users) so a Client searching "marble" cannot learn a stock request exists — that query is never run for that role. `pg_trgm` GIN indexes (installed into the `extensions` schema, not `public`); `rpc_check_rate_limit`, a plain locked-row sliding-window counter (no Redis/Upstash in this stack), 20/min/user. `SearchBar.tsx` debounced 300ms client-side on top of the action's own 2-char minimum and rate limit. |
| Four converted routes + dialogs | ✅ | `stock/page.tsx` (project + package level, status tabs, package filter, admin-only Value column, `availableTransitions`-derived per-row actions), `inventory/page.tsx` (project + business-wide, Project column and filter on the business view), `NewRequestDialog` (real Package/Phase/Unit dropdowns, material suggestions, Rate admin-only and server-stripped), `RejectStockRequestDialog` (new — required-reason field error, not a generic toast), `ReqTable`/`InventoryTable` (props, not `useApp()`), dashboard's Pending Requests card. |
| `scripts/gen-types.mjs` | ✅ | Fixed a real generator bug: `RETURNS TABLE(...)` output columns were leaking into the generated `Args` type because the `information_schema.parameters` query didn't filter by `parameter_mode`. |
| `supabase/seed.sql` | ✅ | Amended twice more (Build 02's file): linked `inventory_item_id` for the three seeded delivered requests and added opening-balance movements (D32); advanced `next_sr_seq` past the sixteen pre-existing `SR-BHEL-NCH-0NN` numbers (D36). |
| `db/schema/` | ✅ | `search.ts` (new, `rateLimits`) and `projects.nextSrSeq` — both existed in the database via migration but were missing from Drizzle until the drift test caught it (D37). |

### Real bugs and gaps found only by actually running it

| Finding | Where |
|---|---|
| **`v_notifications`'s `bill_submitted` branch returned zero rows for Client, silently, since migration 0015** — it read `public.bills` directly on the stated assumption that RLS scoped it correctly, but `bills` has no select policy for Client at all. A Client session never saw "Bill RA-... awaiting certification" — the one notification that matters most, since only a Client may certify a bill. Caught by testing from a real Client JWT, not service_role. | D33 |
| **The exact same bug, one branch over: `stock_request` returned zero rows for Site**, since the same migration — it read `public.stock_requests` directly, and that table is admin-only on select. Caught by an actual Playwright run under a real Site session (the bell showed only `inventory_low` items); this build's own integration test had already been written for this and passed anyway, because its assertion was `stock_request OR inventory_low` — the weak `||` let `inventory_low` alone (that table's policy does include Site) hide `stock_request` being silently empty. Both the migration and the test assertion are fixed. | D35 |
| **`next_sr_seq` was never advanced past the seeded `SR-BHEL-NCH-001..016` numbers** — defaulted to 1 for the existing project row when the column was added, so the first real `rpc_create_stock_request` calls succeeded up to seq 8 and then failed on seq 9 with a raw `sr_ref_uq` duplicate-key error. The exact same class of gap `next_bill_seq`'s own seed fix already exists to prevent; just missed here. Caught by the integration suite, not by hand. | D36 |
| **`unit_cost`'s admin/site wording in the build file itself contradicts AGENTS.md**, which names that exact column in its never-to-a-non-admin list. AGENTS.md wins. | D30 |
| **`movement_direction`'s `'adjust'` enum value has no sign of its own** — recorded as an ordinary `'in'`/`'out'` movement tagged `ref_type = 'adjustment'` instead. | D31 |
| **Seeded inventory had zero `stock_movements` behind it** — would have made `inventory.reconcile` alert on all eight items on its first real run. | D32 |
| **`getByText()`'s default substring match falsely passed a Playwright assertion mid-mutation** — `getByText("Ordered")` matched the still-present "Mark Ordered" button label before the real transition committed, so the test closed its browser context early and cancelled the in-flight request, leaving a real stock request stuck on "approved" forever. Fixed with `{ exact: true }` throughout the journey spec. | `e2e/stock-inventory-journey.spec.ts` |
| **This build's own integration test file initially left the dev database with a real, permanent drift** — a delivery's cache bump was reverted by deleting the movement row in `afterEach` without reverting the cache it had justified. Fixed: disposable inventory items instead of a seeded one, `try/finally` around the drift-injection test. | `tests/integration/stock-and-inventory.test.ts` |
| **A date rendered as `7/9/2026` instead of the app's own `06 Sep 2026` convention** — `ReqTable`'s conversion used `toLocaleDateString` instead of `lib/logic.ts`'s established `dmy()`. Caught by the visual-parity screenshot diff, not by lint (the AGENTS.md restriction only names `toLocaleString`/`Intl` literally). | `components/domain/ReqTable.tsx` |
| **A pre-existing Build 05 e2e test left a stray far-future task behind on a failed run and never cleaned it up**, because it tracked the created row by an id only captured several `await`s after the row actually existed — a run that failed in between (confirmed live, under load from running the full suite) silently widened every later run's Gantt viewport baseline, cascading into two unrelated tests' failures until traced back and the stray row removed by hand. Fixed with the same pattern already used in this build's own `stock-and-inventory.test.ts`: name the row before any risky `await`, clean up by that name regardless of where the test fails. | `e2e/schedule-journey.spec.ts` |
| **`LegacyDashboardCards.tsx`'s two TODOs had their build numbers swapped** by Build 04 — Pending Requests was labelled `build-08`, Pending Approvals `build-07`, backwards from what this build (and the build file's own §2.5 step 6) actually covers. | D34 |

Visual-parity diffs against `proto-v1` for the four converted routes are real but expected: more
rows now exist than the frozen prototype ever had (the seed grew twice since — six stock requests
in the original prototype dataset vs sixteen now, two of which this build's own RPC work added to
exercise the `approved`/`ordered` states), and `v_inventory_status`/`v_inventory_site` order by
name rather than the mock array's arbitrary insertion order. Layout, spacing, fonts, badge colours
and button styling are pixel-identical once those two are accounted for.

### Still open

| Item | Blocks |
|---|---|
| `docs/progress-tracker.md` visual-parity note above should be treated as the "documented differences" record the build's own exit criteria ask for | Nothing — recorded, not blocking |
| Commit, push, PR, CI | Merge |
