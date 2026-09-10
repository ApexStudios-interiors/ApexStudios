# Apex Projects

The internal operations platform for **Apex Studios**, an interiors and construction contractor
in India. Projects break down into packages → phases → tasks; the platform tracks material flow
and inventory, collects client sign-off on samples and drawings, and generates GST-compliant RA
(Running Account) bills.

Three roles see genuinely different data: **Admin**, **Site Supervisor**, **Client**.

> **Only Admin ever sees internal cost or margin.** Clients see what they are charged. Site
> Supervisors see no money at all. This is enforced in the database, not in the UI.

---

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase + R2 credentials
pnpm env:check               # confirms every key is present and well-formed
pnpm db:inspect              # read-only: what is already in that database?
pnpm db:bootstrap            # migrations -> D15 spike -> seed -> pgTAP -> tests
pnpm dev                     # http://localhost:3000
```

Requires Node >= 20 and pnpm (via `corepack enable`). **No Docker** — there is no
local database. Development runs against the hosted `apex-dev` project, so you
need a network connection, and `apex-dev` is shared with everyone else on the
team. Destructive experiments belong on a pull request's preview branch. See
`docs/decisions.md` D14.

## Commands

| Command                                  | What it does                                            |
| ---------------------------------------- | ------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js dev server, production build, production server |
| `pnpm typecheck`                         | `tsc --noEmit`, strict                                  |
| `pnpm lint` / `pnpm format`              | ESLint with the architecture rules / Prettier           |
| `pnpm test` / `pnpm test:coverage`       | Vitest                                                  |
| `pnpm test:rls`                          | pgTAP policy tests. Fails on an empty suite, by design. |
| `pnpm test:e2e`                          | Playwright, three role journeys                         |
| `pnpm env:check`                         | Validate `.env.local` against the schema                |
| `pnpm db:*`                              | Supabase local stack, migrations, generated types       |
| `pnpm verify`                            | typecheck + lint + test + build                         |

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

## Stack

Next.js 16 App Router · React 19 · TypeScript strict · Tailwind v4 with hand-rolled primitives ·
Supabase Postgres with RLS · Drizzle for schema and migrations · Cloudflare R2 · Vercel Cron with
a `jobs` table · Sentry.

There is no separate backend service. Server Actions and Route Handlers are the backend.

## The data-access rule

User-context reads and writes go through the Supabase client bound to the user's JWT, so RLS
applies. Money and stock mutations go through `security definer` RPCs. Drizzle is for schema,
migrations, generated types and `service_role` job handlers only — a Drizzle query in a request
path bypasses RLS entirely and is blocked by lint. See `docs/decisions.md` D11.
