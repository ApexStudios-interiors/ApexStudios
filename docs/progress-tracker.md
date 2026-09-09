# Progress Tracker

Updated by the agent at the end of every build file. One row per numbered step.

Legend: ✅ done and verified · 🟡 done, but something is unverified or deferred ·
⛔ blocked on someone · ⬜ not started

---

## Build 01 — Foundations

Branch `build/01-foundations`, open as **PR #1**, CI green. Baseline tag `proto-v1` at commit `e52d6cc`.

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

## Build 02 — Database
Not started. Unblocked on decisions. **Blocked on the `apex-dev` Supabase project existing** — D14 removed the local stack, so there is no way to run a migration or a pgTAP test without it.

## Build 03 — Auth and RBAC
Not started. Needs the transactional email provider for client magic links.

## Builds 04–10
Not started.
