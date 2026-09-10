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
