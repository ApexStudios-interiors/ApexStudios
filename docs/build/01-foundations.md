# Build 01 — Foundations, Decisions & Repository Consolidation

> **This file is a prompt.** Give it to Claude Code as the whole task for this stage.
> Read `docs/AGENTS.md`, `docs/01-hld.md`, `docs/02-lld.md`, `docs/architecture.md` and
> `docs/ai-workflow-rules.md` before writing a line of code.
>
> **Depends on:** nothing. This is the first file.
> **Blocks:** every other build file.
> **Branch:** `build/01-foundations`

---

## 0. Prerequisites — what a human must do outside the codebase

Nothing in §3 can be finished until these are done. Work through them in order. If an item is
not done, **stop and say so** rather than inventing a placeholder and carrying on.

### 0.1 Close the open decisions

`01-hld.md` §18 lists ten decisions (D1–D10) that block schema work, and `architecture.md`
§16 lists five more. Three additional decisions surfaced while reading the code and are
listed here as D11–D13. Every one needs a written answer from Voola before migration 0002 is
written in Build 02.

| # | Question | Recommendation |
|---|---|---|
| D1 | Client portal, or internal-only? | **Client role stays.** The whole UI is built around it. |
| D2 | Simple inventory, or warehouses/GRN/WAC now? | **Simple now.** Keep the movement ledger so WAC is additive. |
| D3 | One org forever, or resell to other contractors? | **Single org**, `org_id` on every table from day one. |
| D4 | Material-at-site: secured advance or sale of goods? | **Secured advance** — pending CA (see Build 09). |
| D5 | Does the platform compute TDS? | **Informational line only**, not a tracked liability. |
| D6 | Bills per-project or per-package? | **Per-project**, spanning packages, `RA-{code}-{n}`. |
| D7 | Mobilisation advance tracking needed? | Needed only if a live contract has one. **Answer required.** |
| D8 | Is there an `owner` above the four admins? | **Yes, add `owner`.** Collapses to `admin` at no cost if not. |
| D9 | Can one client have several projects? | **Yes**, design for it. |
| D10 | Accept Supabase preview branches per PR? | **Yes.** |
| ADR-016 | Vercel Pro + Supabase Pro at go-live? | **Yes, day one.** ~₹4,000/mo. Per-minute cron and PITR both depend on it. |
| A-4 | Antivirus scanning of uploads? | **Out for v1.** Confirm explicitly. |
| A-6 | Client prompting with no email in v1? | Confirm phone-chasing, or scope WhatsApp/SMS instead. |
| A-5 | Statutory retention period for archived projects | **Exact figure needed from the CA** before R2 lifecycle rules. |
| **D11** | **Does application data access go through Drizzle or the Supabase client?** | **See §0.2 — this is the most consequential one and it is new.** |
| **D12** | Package manager and stack version drift | **See §0.3.** |
| **D13** | Repository layout — `src/` or root? | **Root.** See §0.3. |

Record every answer in `docs/decisions.md` using the template in §3.2. An unanswered decision
is a blocker, not a default.

### 0.2 D11 — read this before agreeing to anything else

`architecture.md` §4 shows `service.ts → lib/db (Drizzle)` for application queries, and
`AGENTS.md` says "Supabase Postgres (datastore + auth). **Drizzle** for typed queries."

**A Drizzle connection over `postgres-js`/`DATABASE_URL` authenticates as a privileged
database role and bypasses Row Level Security completely.** Every policy in `02-lld.md` §6
becomes decorative. The product's single most important promise — a client cannot see
`internal_amount` — would rest on nothing but application code being correct.

There are exactly two safe resolutions:

- **(A) Recommended.** The **Supabase JS client bound to the user's JWT** (via `@supabase/ssr`)
  is the only path for user-facing reads, writes and `rpc_*` calls. RLS applies automatically
  because PostgREST runs the query as `authenticated` with the user's claims. Drizzle is kept,
  but only for: schema definition, migration generation, generated types, and queries inside
  `lib/jobs/handlers/**` that legitimately run as `service_role`.
- **(B)** Keep Drizzle for application queries, but route **every** query through an
  RLS-aware wrapper that opens a transaction and issues
  `set local role authenticated; set local request.jwt.claims = '…'`. One forgotten call site
  is a silent, total RLS bypass with no error and no test failure.

Take (A). It makes the safe path the only path, which is the whole argument for the three-layer
model in the first place. (B) makes correctness a thing every future contributor has to
remember, forever, with one maintainer to notice when they don't.

Whichever is chosen, **write it into `AGENTS.md` and `architecture.md` §4 in this build file's
PR**, because those documents currently imply the unsafe option.

### 0.3 D12 / D13 — stack drift between the docs and the code

The docs describe a system that does not match the repository. Reconcile now, once.

| Topic | Docs say | Repo actually is | Decision |
|---|---|---|---|
| Package manager | pnpm | npm (`package-lock.json`) | **Migrate to pnpm.** One lockfile change vs. editing four documents and a CI pipeline. Reversible. |
| Next.js | 15 | **16.3.4** | **Keep 16.** Update the docs. Verify `next-safe-action` supports it (§3.6). |
| React | — | 19.2.8 | Keep. |
| UI primitives | shadcn/ui | Hand-rolled `components/ui/*` | **Keep what is built. Do not introduce shadcn.** The UI is finished and is the functional spec. Amend `AGENTS.md`. |
| Layout | `src/app`, `src/features` | `app/` at root | **Keep root.** Moving to `src/` churns every import for zero value. Amend `AGENTS.md` and `02-lld.md` §8.1. |
| Docs location | `docs/01-hld.md` | `../context-all/*.md` | **Move into the repo** (§3.1). |

### 0.4 Accounts, services and credentials to create

Each line produces a secret or an identifier that Build 01 needs. Create them in this order;
several depend on the one above.

- [ ] **GitHub** — private repository for `apex-dashboard`, push the existing history to it.
      Enable branch protection on `main`: require CI green, require one review.
- [ ] **Supabase organisation** and **two projects**:
      `apex-prod` in **ap-south-1 (Mumbai)** and `apex-dev` in the same region.
      Capture for each: project ref, `SUPABASE_URL`, `anon` key, `service_role` key,
      and the direct `DATABASE_URL` (Settings → Database → Connection string).
- [ ] **Supabase plan** — upgrade `apex-prod` to **Pro** (ADR-016). Free tier has no
      point-in-time recovery and pauses after seven days idle.
- [ ] **Supabase preview branching** — enable on the project (D10), and connect the GitHub repo.
- [ ] **Vercel** — team + project, framework Next.js, **region `bom1`**, connected to the GitHub
      repo. Upgrade to **Pro** (per-minute cron in Build 06 requires it; Hobby also forbids
      commercial use, and this system issues tax invoices).
- [ ] **Cloudflare R2** — three buckets, all **private**, location hint **APAC**:
      `apex-prod`, `apex-preview`, `apex-backups`.
      Create **two separate API tokens**: one scoped to `apex-prod` + `apex-preview` for the
      app, one scoped to `apex-backups` only. A compromised app token must not be able to
      destroy the backups. Capture account id, both key pairs, and the S3 endpoint.
- [ ] **Sentry** — organisation + a Next.js project. Capture the DSN and an auth token for
      source-map upload.
- [ ] **Domain** — `app.beapex.in` DNS pointed at Vercel; TLS issued; HSTS planned for Build 10.
- [ ] **Transactional email provider** (Resend or AWS SES) — needed in Build 03 for client
      magic links. Supabase's built-in SMTP is rate-limited to a handful of emails per hour
      and is not usable for real logins. Verify the sending domain (SPF + DKIM records).
      *Not needed to finish Build 01, but the DNS propagation delay makes it worth starting now.*
- [ ] **`CRON_SECRET`** — generate a 32-byte random value (`openssl rand -base64 32`). Used in
      Build 06.
- [ ] Local machine: **Node 20+**, **pnpm 9+**, **Docker Desktop running**, **Supabase CLI**,
      **`psql`**, and the **Vercel CLI**.

### 0.5 Book, don't block

Start these now because their lead time is long; they only become blocking later.

- [ ] **Engage the CA.** Five tax questions in `01-hld.md` §8.4 must be answered before Build 09
      ships and before the first real bill is issued. Send them the HLD §8.4 extract today.
- [ ] Collect **Apex Studios' legal details** for bill headers: legal name, GSTIN, PAN,
      registered address, bank details, logo file.
- [ ] Collect the **real staff list** (name, email, phone, role) for Build 03.
- [ ] Ask counsel for the **DPDP Act 2023** obligation set (`architecture.md` §12).

---

## 1. Objective

Turn a client-side prototype repository into the foundation of a production application:
documentation in-repo and truthful, tooling and typing strict, environments wired, CI running,
and the layering rules mechanically enforced — **without changing a single pixel of the UI.**

At the end of this file the app still runs entirely on `AppContext` and seed data. That is
correct. Backend substitution starts in Build 04 and is incremental.

---

## 2. Context to load first

| Read | For |
|---|---|
| `01-hld.md` §4 | Layering rules, why there is no separate backend service |
| `02-lld.md` §1, §8 | Naming conventions, route tree, money formatting |
| `architecture.md` §4, §5, §10 | Component view, environments, CI pipeline |
| `AGENTS.md` | Every hard rule you are about to be held to |
| `app/layout.tsx`, `context/AppContext.tsx`, `lib/logic.ts` | What currently drives the UI |

---

## 3. Steps

### 3.1 Consolidate documentation into the repository

The repo root is `apex-dashboard/`. The design documents currently sit outside it, so nothing
in CI or the agent workflow can see them.

1. `git mv` (or move + `git add`) the contents of `../context-all/` into `docs/`:
   ```
   docs/01-hld.md
   docs/02-lld.md
   docs/architecture.md
   docs/system-overview.md
   docs/ai-workflow-rules.md
   docs/code-standards.md
   docs/progress-tracker.md
   docs/build/01-foundations.md … docs/build/10-hardening-and-launch.md
   ```
2. Move `UI-GUIDE.md` to `docs/ui-guide.md`. It is the functional specification for the UI and
   belongs with the other design documents.
3. Keep `AGENTS.md` and `CLAUDE.md` at the repo root — that is where agents look for them.
   `CLAUDE.md` stays a one-line `@AGENTS.md` include.
4. Fix every cross-reference: `AGENTS.md` currently points at `docs/01-hld.md` (now correct),
   `system-overview.md` §19 points at `ARCHITECTURE.md` (should be `architecture.md`).
5. Delete the stray mockup file `Apex Projects - App Mockup (07.09.2026).html` from the parent
   directory, or move it to `docs/reference/` if it is still wanted. It is not the spec —
   `docs/ui-guide.md` is.

### 3.2 Create the decision register

Create `docs/decisions.md`. One entry per decision from §0.1, in this shape:

```markdown
### D8 — Is there an `owner` role above the four admins?
**Answered:** 2026-09-12 by Voola
**Answer:** Yes. John Israel Voola is `owner`; Suresh K, Prakash R, Meena D are `admin`.
**Consequence:** `app_role` enum includes `owner`. `setUserRole` and billing-constant edits
are owner-only. See 02-lld.md §2.
```

Seed the file with all sixteen decisions, marked `**Answered:** PENDING` where they are.
**Any build file that hits a `PENDING` decision it depends on must stop and ask.**

### 3.3 Reconcile `AGENTS.md` with reality

Edit `AGENTS.md` so it describes the system that exists and the one being built. Specifically:

- **Setup section:** `pnpm` commands are correct once §3.4 is done. Keep.
- **Stack section:** Next.js **16**, React 19, Tailwind v4, **hand-rolled UI primitives in
  `components/ui/` — not shadcn**. Add an explicit line: *"The UI is complete and is the
  functional specification. Do not restyle, do not swap the component library, do not
  introduce a design system. Changes to `components/ui/` require a stated reason."*
- **Repository layout:** replace the `src/`-rooted tree with the real one (§3.5).
- **Data access:** state the D11 answer as a hard rule. If (A): *"User-facing reads and writes
  go through the Supabase server client bound to the user's JWT. Drizzle is for schema,
  migrations, generated types and `service_role` job handlers only. A Drizzle query in a
  request path is an RLS bypass and is a blocking review comment."*
- Add a **Documentation map** section pointing at `docs/`.

### 3.4 Migrate to pnpm

```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm import                 # reads package-lock.json → pnpm-lock.yaml
rm package-lock.json && rm -rf node_modules
pnpm install
pnpm build                  # must pass before continuing
```
Add `packageManager` to `package.json`. Add `.npmrc` with `engine-strict=true`.
Add an `engines` field: `{ "node": ">=20" }`.

### 3.5 Scaffold the directory structure

Create the layout the design documents assume, at the repo root (D13):

```
app/                     ← exists. Route segments only. Thin.
components/
  ui/                    ← exists. Primitives. No business logic. Do not restyle.
  layout/ domain/ dialogs/  ← exist. Will gain props instead of useApp() from Build 04.
features/                ← NEW. One folder per domain.
  <domain>/
    schema.ts            zod, shared by form and action
    service.ts           pure logic. NEVER imports next/*
    queries.ts           role-shaped reads
    actions.ts           guard → parse → service → revalidate
    components/          feature-owned UI
lib/
  supabase/              server.ts, client.ts, admin.ts, middleware.ts
  r2/ jobs/ rbac/ money/ pdf/ xlsx/ observability/
  env.ts                 validated environment
db/
  schema/                Drizzle table definitions
  types.ts               generated
supabase/
  migrations/            versioned SQL — the source of truth for schema
  seed.sql
  tests/                 pgTAP
  config.toml
e2e/                     Playwright
docs/                    design documents, build plan, runbooks
```

Add a `.gitkeep` where a folder is empty. Do **not** create empty `service.ts` stubs — empty
files invite guessing.

### 3.6 Install the dependency set

One `pnpm add` per group so a failure is legible. Pin exact versions in `package.json` for the
security-relevant ones.

```bash
# data + auth
pnpm add @supabase/supabase-js @supabase/ssr drizzle-orm postgres
pnpm add -D drizzle-kit supabase

# validation, actions, forms
pnpm add zod next-safe-action react-hook-form @hookform/resolvers

# tables, storage, documents
pnpm add @tanstack/react-table
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
pnpm add @react-pdf/renderer exceljs sharp

# money + dates
pnpm add decimal.js date-fns

# observability
pnpm add @sentry/nextjs
pnpm add server-only

# testing
pnpm add -D vitest @vitejs/plugin-react vitest-environment-vercel-edge? (skip if unused)
pnpm add -D @vitest/coverage-v8 @playwright/test
pnpm add -D prettier eslint-plugin-import
```

**Verify `next-safe-action` supports Next.js 16 before building on it.** Write one throwaway
action, call it from a client component, confirm it round-trips. If it does not support 16,
stop and report — the fallback is a thin hand-rolled `createAction(schema, guard, handler)`
wrapper, which is ~40 lines, and that choice must be made deliberately rather than discovered
in Build 04.

`sharp` is only used inside a job handler; confirm it resolves on the Vercel Node runtime
before Build 06 depends on it.

### 3.7 Strict TypeScript and path aliases

`tsconfig.json`:
```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "paths": { "@/*": ["./*"] }
  }
}
```
`noUncheckedIndexedAccess` will surface real errors in existing code (`s.slice(-3)` patterns in
`lib/logic.ts`, `t.split(" ").map(x => x[0])` in `initials`). **Fix them properly — narrow the
type. Do not add `!` and do not add `any`.** Both are forbidden by `AGENTS.md`.

Add `pnpm typecheck` → `tsc --noEmit`.

### 3.8 Validated environment configuration

Create `lib/env.ts`. Parse `process.env` with zod at module load and export a typed object.
The build must fail loudly on a missing variable, not at 2 a.m. on a null dereference.

```ts
import 'server-only';
import { z } from 'zod';

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET: z.string().min(1),
  CRON_SECRET: z.string().min(32),
  SENTRY_DSN: z.string().url().optional(),
});
export const env = serverSchema.parse(process.env);
```

A separate `lib/env.client.ts` exports only `NEXT_PUBLIC_*` values. Add a comment at the top:
*"Anything in this file is public. Treat it as printed on a billboard."*

Write `.env.example` listing **every** key with placeholder values and a one-line comment each.
Confirm `.env.local` is gitignored (it is) and that `.env.example` contains no real value.

### 3.9 Supabase local development

```bash
pnpm supabase init
pnpm supabase start          # requires Docker
```
Commit `supabase/config.toml`. Set the local JWT expiry to 1800s to match production
(`01-hld.md` §6). Add scripts:

```json
"db:start":     "supabase start",
"db:reset":     "supabase db reset",
"db:migration": "supabase migration new",
"db:types":     "supabase gen types typescript --local > db/types.ts",
"db:diff":      "supabase db diff"
```

`pnpm db:reset` must succeed against an empty `supabase/migrations/` before Build 02 starts.

### 3.10 Drizzle configuration

`drizzle.config.ts` pointed at `db/schema/`, dialect `postgresql`, `DATABASE_URL` from env.

**Drizzle generates nothing authoritative.** `supabase/migrations/*.sql` is the source of truth
for schema (`AGENTS.md` database rule 1). Drizzle's role is typed access and drift detection.
Add `pnpm db:check-drift` that runs `drizzle-kit check` (or diffs generated SQL against the
migration set) and fails CI if the schema and the Drizzle definitions disagree.

### 3.11 Lint rules that enforce the architecture

The layering rules in `AGENTS.md` are only real if a machine checks them. Add to
`eslint.config.mjs`:

1. **`service.ts` may not import `next/*`:**
   ```js
   { files: ['features/*/service.ts'],
     rules: { 'no-restricted-imports': ['error', { patterns: ['next/*', 'next', 'server-only'] }] } }
   ```
2. **`service_role` is import-restricted** to `lib/jobs/handlers/**` and `lib/auth/admin.ts`
   (`architecture.md` §4.1). Restrict imports of `lib/supabase/admin` everywhere else.
3. **Components may not import `queries.ts` or the db layer.** Restrict `db/*` and
   `features/*/queries` from `components/**`.
4. **No `any`, no non-null assertion**: `@typescript-eslint/no-explicit-any`,
   `@typescript-eslint/no-non-null-assertion`, both `error`.
5. **No raw currency formatting**: restrict `toLocaleString` outside `lib/money/`.
   `AGENTS.md` requires `formatINR()` everywhere.
6. Prettier via `eslint-config-prettier`; add `pnpm format` and `pnpm lint`.

Each rule needs a one-line comment saying which document rule it enforces. A lint error whose
reason is unknowable gets disabled by the next person in a hurry.

### 3.12 Test harness

- `vitest.config.ts` — `environment: 'node'`, `globals: true`, coverage `v8`, `setupFiles` for
  a shared test database URL. Add a `coverage.thresholds` block now with the billing path
  carved out at 100% branch (it will have nothing to measure until Build 09; wire the gate
  early so it cannot be argued about later).
- `playwright.config.ts` — three projects, one per role, `baseURL` from env, retries 1 on CI,
  trace on first retry.
- Add `test`, `test:watch`, `test:rls`, `test:e2e` scripts. `test:rls` runs the pgTAP suite via
  the Supabase CLI; it will have no tests until Build 02 — make it exit non-zero if the suite
  directory is empty, so "0 tests passed" can never read as green.

### 3.13 Sentry

`pnpm dlx @sentry/wizard@latest -i nextjs`, then trim what it generates:
- Scope carries `user.id` and `role` **only** (`architecture.md` §6.4). No name, no email.
- Add `beforeSend` that strips any key matching
  `/amount|rate|cost|margin|allocated|internal|price/i` from `extra` and breadcrumbs. Write a
  unit test for it — the redaction rule is a data-classification control, not a nicety.
- Source maps uploaded at build, release tagged with the git SHA.
- Disable Sentry in development.

### 3.14 Health endpoint

`app/api/health/route.ts` — `GET`, `dynamic = 'force-dynamic'`, returns
`{ db, r2, version, uptime }` after a `select 1` and an R2 `HeadBucket`, `200` when both pass
and `503` otherwise. `version` is the git SHA from `VERCEL_GIT_COMMIT_SHA`. It must never
require authentication and must never leak configuration.

### 3.15 CI pipeline (skeleton)

`.github/workflows/ci.yml`, running on PR and on push to `main`:

```
install (pnpm, --frozen-lockfile)
  → typecheck
  → lint
  → secret scan (gitleaks)
  → unit tests
  → build
```

Database, RLS, integration and e2e stages are added in Build 02 and Build 10 as they gain
content. Configure the jobs so a later `continue-on-error` cannot be added to the RLS stage —
document in the workflow file that it is blocking by policy (`architecture.md` §10.1).

Add Dependabot weekly and a `pnpm audit --audit-level=high` gate.

### 3.16 Vercel project configuration

- Link the project (`vercel link`), set the region to `bom1`.
- Add every server env var for Production and Preview. `NEXT_PUBLIC_*` only for genuinely
  public values.
- `vercel.json`: `{ "regions": ["bom1"] }`. The `crons` array is added in Build 06 — adding it
  now against routes that do not exist produces failing invocations and alert noise.
- Confirm the preview deployment builds from a PR before closing this build file.

### 3.17 Freeze the prototype as a reference

1. Tag the current commit: `git tag proto-v1 && git push --tags`. It is the visual and
   behavioural baseline; Build 04–09 will diff against it.
2. Copy `lib/data.ts` to `docs/reference/prototype-dataset.ts` with a header comment. Build 02
   translates it into `supabase/seed.sql` with fixed UUIDs, and having it frozen separately
   means the seed can be checked against it after `lib/data.ts` is eventually deleted.
3. Capture Playwright screenshots of every route in all three roles, in light and dark, into
   `e2e/__screenshots__/proto-v1/`. These are the visual-parity reference for Build 04 onward.
   **Do this before any refactor.** It cannot be recreated later.

### 3.18 Set up the progress tracker

`docs/progress-tracker.md` is empty. Give it this structure and fill in Build 01's rows:

```markdown
# Progress Tracker
Updated by the agent at the end of every build file. One row per numbered step.

## Build 01 — Foundations
| Step | Status | PR | Notes |
|---|---|---|---|
| 3.1 Docs consolidated | ✅ | #1 | |
| 3.2 Decision register | 🟡 | #1 | D4, D7 still PENDING — blocks Build 09 |
...

## Open blockers
| Blocker | Blocks | Owner | Raised |
|---|---|---|---|
| CA sign-off on GST treatment | Build 09 | Voola | 2026-09-09 |
```

---

## 4. Verification — the exit criteria

Every one of these must pass before opening the PR:

```bash
pnpm install --frozen-lockfile
pnpm typecheck          # zero errors, strict, no any, no !
pnpm lint               # zero errors, architecture rules active
pnpm test               # harness runs (may report 0 tests)
pnpm build              # production build succeeds
pnpm db:start && pnpm db:reset   # local Postgres comes up clean
curl localhost:3000/api/health   # 200, { db, r2, version, uptime }
```

Manual checks:
- [ ] `pnpm dev` — the app looks **pixel-identical** to tag `proto-v1` in all three roles, light
      and dark. Screenshot diff, not eyeballs.
- [ ] Deliberately break a rule and confirm lint catches it: add `import { headers } from 'next/headers'`
      to a `features/*/service.ts` file. Then remove it.
- [ ] Delete a required key from `.env.local` and confirm the app fails at boot with a clear
      message naming the key.
- [ ] A pull request produces a green CI run and a working Vercel preview URL.
- [ ] `docs/decisions.md` exists, with D1–D13 present and each either answered or explicitly
      `PENDING` with a named blocker.

---

## 5. Guardrails — do not

- **Do not touch the UI.** No restyling, no component-library swap, no "while I was in there".
  The only files under `components/` that should change in this build are import paths.
- **Do not write any migration.** Build 02 owns the schema. A table created here would not go
  through the RLS-in-the-same-file rule.
- **Do not delete `context/AppContext.tsx` or `lib/data.ts`.** They keep the app running until
  Build 04–09 replace them feature by feature. Deleting them now breaks every page at once.
- **Do not commit a real key**, including into `.env.example`, a test fixture, or a doc.
- **Do not resolve a `PENDING` decision by picking the recommendation yourself.** The
  recommendations in §0.1 are arguments, not answers.
- **Do not weaken `strict`, `noUncheckedIndexedAccess`, or any lint rule** to make existing code
  compile. Fix the code.

---

## 6. Deliverables

- [ ] `docs/` populated; all cross-references correct
- [ ] `docs/decisions.md` with sixteen entries
- [ ] `AGENTS.md` reconciled with reality and carrying the D11 data-access rule
- [ ] `pnpm-lock.yaml` committed, `package-lock.json` gone
- [ ] Directory scaffold in place
- [ ] `lib/env.ts`, `.env.example`
- [ ] `supabase/` initialised, `pnpm db:reset` green
- [ ] `drizzle.config.ts`, drift check script
- [ ] Architecture-enforcing ESLint rules, each commented with its source rule
- [ ] Vitest + Playwright configured; `test:rls` fails on an empty suite
- [ ] Sentry wired with the money/PII redaction filter **and its unit test**
- [ ] `/api/health`
- [ ] CI green on a PR; Vercel preview builds
- [ ] Tag `proto-v1`; baseline screenshots committed
- [ ] `docs/progress-tracker.md` initialised and filled in

---

## 7. Hand-off note for Build 02

In the PR description, state explicitly:
1. The D11 answer and where it is now written down.
2. Which decisions remain `PENDING` and what they block.
3. Whether `next-safe-action` works on Next.js 16, or that a hand-rolled wrapper is needed.
4. Whether `sharp` resolves on the Vercel Node runtime.
