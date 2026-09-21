# Apex Projects

The internal operations platform for **Apex Studios**, an interiors and construction contractor
in India. Projects break down into packages → phases → tasks; the platform tracks material flow
and inventory, collects client sign-off on samples and drawings, and generates GST-compliant RA
(Running Account) bills.

Four roles see genuinely different data: **Owner**, **Admin**, **Site Supervisor**, **Client**.

> **Only Owner and Admin ever see internal cost or margin.** Clients see what they are charged.
> Site Supervisors see no money at all. This is enforced in the database by RLS and
> column-omitting views, not in the UI.
>
> One deliberate exception: a project can be set to show material **rate** on a stock request to
> its Site Supervisors. It is `hidden` on every project by default and is enforced server-side
> (`docs/decisions.md` D55).

**Live:** https://apex-studios-eight.vercel.app · health check at `/api/health`

---

## ⚠️ Read this before running anything

**There is exactly one Supabase project, and it is production.** There is no `apex-dev`, no local
database, no preview branch (`docs/decisions.md` D49). `pnpm dev` reads and writes **live data**.

Because of that, these commands refuse to run against the production project and therefore cannot
run at all today: `db:reset`, `db:seed`, `db:bootstrap`, `test:rls`, `test:integration`,
`db:check-drift`. That guard is deliberate — it exists because CI used to seed the live database
on every pull request.

`pnpm test:e2e` has **no such guard**. Never run it: it creates real rows and signs in as real
users.

Getting a separate non-production project is the single change that would unblock the test suite,
CI, and refreshing the visual baseline.

## Getting started

```bash
corepack enable
pnpm install
cp .env.example .env.local   # fill in Supabase + R2 credentials
pnpm env:check               # every key present and well-formed
pnpm db:inspect              # read-only: what is already in the database?
pnpm dev                     # http://localhost:3000
```

Node >= 20, pnpm 12 (via corepack). No Docker.

Sign in with a username and password — there is no magic link (D51). Ask the owner for
credentials; there is no self-service password reset, so an owner or admin has to issue one.

## Commands

| Command                                                           | What it does                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                                    | Next.js dev server, production build, production server          |
| `pnpm verify`                                                     | typecheck + lint + test + build — run this before any PR         |
| `pnpm typecheck`                                                  | `tsc --noEmit`, strict                                           |
| `pnpm lint` / `pnpm format`                                       | ESLint with the architecture rules / Prettier                    |
| `pnpm test` / `test:coverage`                                     | Vitest unit tests                                                |
| `pnpm env:check`                                                  | Validate `.env.local` against the same schema the app uses       |
| `pnpm db:inspect`                                                 | Read-only summary of the database                                |
| `pnpm db:push`                                                    | Apply pending migrations — **writes to production**              |
| `pnpm db:migration <name>`                                        | Scaffold a new timestamped migration                             |
| `pnpm db:types`                                                   | Regenerate `lib/supabase/database.types.ts` from the live schema |
| `pnpm check:release`                                              | Release gate; currently red on the placeholder legal identity    |
| `test:rls` `test:integration` `db:reset` `db:seed` `db:bootstrap` | Blocked — see the warning above                                  |

Building locally: do **not** `source .env.local` first. It exports `NODE_ENV=development`, which
`next build` inherits and cannot override, and the build then fails in a way that looks unrelated.

## Stack

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 · **shadcn/ui** (Base UI, not
Radix — use `render`, never `asChild`; `base-nova` style; lucide icons) · Supabase Postgres with
RLS · Drizzle for schema, migrations and generated types · Cloudflare R2 (private bucket,
presigned URLs) · a Postgres `jobs` table for background work. No third-party error tracking (D50).

There is no separate backend service. Server Actions and Route Handlers are the backend.

`components/ui/button.tsx` is intentionally customised, and its lowercase filename is
load-bearing: macOS is case-insensitive but Vercel's Linux build is not. If `shadcn add` offers to
overwrite it, answer **No**.

## How work gets scheduled

Production runs on Vercel **Hobby**, which caps cron frequency at once per day. So the schedule is
split (D47):

| Job                                           | Runs        | Where          |
| --------------------------------------------- | ----------- | -------------- |
| `jobs.drain` — bill PDFs, photo thumbnails    | every 5 min | GitHub Actions |
| `jobs.reap` — requeues jobs whose worker died | hourly      | GitHub Actions |
| `inventory.reconcile`, `backup.verify`        | daily       | Vercel Cron    |
| `weekly.maintenance`                          | Sundays     | Vercel Cron    |
| `backup.nightly` — `pg_dump` → R2             | 01:00 IST   | GitHub Actions |

Anything that fails five times lands on the Admin **Failed Jobs** page rather than failing
silently. A bill PDF typically appears within ~5 minutes of submission, not instantly — GitHub's
scheduler has a 5-minute floor and is best-effort.

**Automatic CI is paused** (`.github/workflows/ci.yml` is `workflow_dispatch` only, D49). The five
jobs are intact; re-enabling means restoring the two triggers — but not before there is a
non-production database.

## Billing is gated

Billing routes return **404** unless `BILLING_ENABLED` is exactly `true` (lowercase; the check is a
strict enum, so `TRUE`, `"true"` or a trailing space all fail the build). It ships dark until a CA
has reviewed a generated RA bill PDF and signed off in writing.

The company's legal identity (name, GSTIN, PAN, address, bank) is still **placeholder data**, so
any PDF generated today is not a valid tax invoice. `pnpm check:release` reports this.

## Documentation

Everything is in [`docs/`](docs/). Start with [`AGENTS.md`](AGENTS.md) — the hard rules — then:

| File                                                     | What it decides                                    |
| -------------------------------------------------------- | -------------------------------------------------- |
| [`docs/01-hld.md`](docs/01-hld.md)                       | Product intent, flows, business rules              |
| [`docs/02-lld.md`](docs/02-lld.md)                       | Schema, RLS policies, RPCs, route tree             |
| [`docs/architecture.md`](docs/architecture.md)           | Production topology, environments, CI, ADR log     |
| [`docs/ui-guide.md`](docs/ui-guide.md)                   | The UI, screen by screen. **The functional spec.** |
| [`docs/code-standards.md`](docs/code-standards.md)       | Conventions                                        |
| [`docs/ai-workflow-rules.md`](docs/ai-workflow-rules.md) | How an agent works through this repo               |
| [`docs/decisions.md`](docs/decisions.md)                 | Answered decisions and their consequences          |
| [`docs/build/`](docs/build/)                             | The ten build files, in order                      |
| [`docs/progress-tracker.md`](docs/progress-tracker.md)   | Where the build has got to                         |

Decisions are numbered (D1…D55). A recommendation in a build file is an argument, not an answer —
only an entry with a named person and a date is a decision.

## The data-access rule

User-context reads and writes go through the Supabase client bound to the user's JWT, so RLS
applies. Money and stock mutations go through `security definer` RPCs, which take row locks.
Drizzle is for schema, migrations, generated types and `service_role` job handlers only — a
Drizzle query in a request path bypasses RLS entirely and is blocked by lint (D11).

RLS restricts **rows**, not **columns**. A rule about which column a user may change needs a
trigger: `trg_profiles_privilege_guard` is why a signed-in user cannot promote themselves to owner
(D54).

## Deploying

Merging to `main` deploys to Vercel automatically. Stacked pull requests must use **Create a merge
commit** — squashing a base PR rewrites the history a stacked PR was built on and makes it
conflict.

Migrations are **not** applied by CI. They are applied by hand with `pnpm db:push` against the
live project, so a migration is the one class of change the local gate cannot check. Review it,
rehearse it inside a transaction you roll back, then apply.

## Known limitations

- No non-production database, so the RLS, integration and e2e suites cannot run.
- No point-in-time recovery (Supabase Free). The nightly R2 backup is the only recovery point.
- Vercel Hobby forbids commercial use, and this system issues tax invoices.
- Deactivating a user ends their app session immediately, but an already-issued token keeps
  working directly against PostgREST for up to 30 minutes.
- GitHub disables scheduled workflows after 60 days of repository inactivity, which would stop
  `jobs.drain` and `jobs.reap` silently.
- The visual baseline in `e2e/__screenshots__/proto-v1/` is stale.
