# AI Workflow Rules

How an AI coding agent works through this repository. `../AGENTS.md` says *what* the rules are;
this says *how to run a build*, and when to stop.

---

## 1. The document map

| Document | Answers | Wins when |
|---|---|---|
| `01-hld.md` | What we are building and why — domain, flows, business rules | intent is disputed |
| `02-lld.md` | How it is specified — schema, RLS, RPC signatures, API surface | a column or a policy is disputed |
| `architecture.md` | How it runs in production — topology, failure modes, SLOs, operations | architecture is disputed |
| `ui-guide.md` | What is on screen and what each role can do | UI behaviour is disputed |
| `../AGENTS.md` | The hard rules for writing code here | always. It is not advisory |
| `code-standards.md` | Concrete conventions — TS, React, SQL, tests | style is disputed |
| `build/01…10` | The order of work, with prerequisites | sequencing is disputed |
| `decisions.md` | What has actually been decided, and by whom | a recommendation is mistaken for an answer |
| `progress-tracker.md` | What is done, what is blocked | you need to know where you are |

**The UI is complete and it is the functional specification.** It is not a wireframe to be
improved on. Where a build file changes it, it says so explicitly and gives the reason.

---

## 2. The build sequence

| # | File | Delivers |
|---|---|---|
| 01 | `01-foundations.md` | Decisions closed, docs in-repo, tooling, CI, environments |
| 02 | `02-database.md` | Schema, RLS, column isolation, seed, pgTAP |
| 03 | `03-auth-and-rbac.md` | Real identity, session, guards, users admin |
| 04 | `04-projects-packages-phases.md` | The money hierarchy on server data |
| 05 | `05-schedule-and-progress.md` | Tasks on real dates, Gantt, progress rollup |
| 06 | `06-files-jobs-daily-updates.md` | R2 pipeline, job runner, daily updates |
| 07 | `07-stock-inventory-notifications.md` | Stock lifecycle, ledger, inventory, bell, search |
| 08 | `08-approvals.md` | Client sign-off |
| 09 | `09-billing.md` | The billing engine |
| 10 | `10-hardening-and-launch.md` | Hardening, ops, migration, cutover |

Run them in order. Each file states what it depends on. **02 and 03 cannot be parallelised with
anything** — every later build reads the schema and the session. 05 can run alongside 06, and 07
alongside 08, if there are two people.

---

## 3. How to run one build file

1. **Read the whole file first**, then `../AGENTS.md`, then the sections of the HLD/LLD it names.
   Do not start at step 1 of §3 having skimmed §0.
2. **Check the prerequisites.** Every build file opens with things a human must do outside the
   codebase. If one is not done, **stop and say which one.** Do not invent a placeholder API key,
   a GST rate, or an answer to a decision.
3. **Check `decisions.md`** for anything the file depends on. A `PENDING` decision is a blocker.
   The recommendations in the build files are arguments; only Voola's written answer is a decision.
4. **Plan before writing.** Post the ordered list of files you will create and change, and what
   each does. If the plan diverges from the build file, say where and why.
5. **Work in the prescribed order.** For a feature build that is always:
   migration + RLS → pgTAP → service → queries → actions → components → Playwright.
   Step 3 before step 6 is not negotiable (`02-lld.md` §13).
6. **Run the verification block** at the end of the file. All of it. Paste the real output.
7. **Update `progress-tracker.md` and `decisions.md`** before opening the PR.
8. **Write the PR description** covering: what shipped, what deviated from the build file and why,
   which decisions were closed, what is still blocked, and any visual differences with screenshots.

One build file is one branch is one PR. Do not merge two.

---

## 4. Stop and ask

Stop, do not guess, when a change touches:

- **Tax arithmetic** — GST rates, TDS, retention treatment, material-at-site
- **What any role can see**, especially cost or margin
- **The stock request, approval or bill state machines**
- **Anything writing to `audit_log`, `stock_movements` or `bill_events`**
- **Whether a field belongs to the client-facing or the internal side of a budget**
- **A decision listed as `PENDING`**
- **A prerequisite that has not been done**
- **A conflict between two design documents** — report it, propose a resolution, get an answer,
  then fix the losing document in the same PR

Also stop when a build file's instruction turns out to be wrong. The files were written from the
design documents, not from a running system; some of them will be wrong. Say so, propose the
correction, and amend the file as part of the work. **A build file is a plan, not scripture — but
diverging from one silently is how a plan stops meaning anything.**

---

## 5. The rule that outranks the others

> **Only Admin ever sees internal cost or margin.**

If a change would put `internal_amount`, `unit_cost`, `rate`, `internal_cost_amount` or
`margin_amount` into a response a non-Admin session could receive: **stop and flag it.**

Do not fix it by hiding the value in the UI. Do not fix it by nulling the field in a DTO. The
number must never be in the response body, because it was never selected
(`01-hld.md` §7 Layer 2).

When in doubt about a new field: if a client seeing it would embarrass Apex commercially, it is
Restricted. Treat it as Admin-only until told otherwise.

---

## 6. Scope discipline

- **Do not add features not in `01-hld.md` §2.1.** Out of scope for v1: labour and timesheets,
  vendor portal, purchase orders, barcode scanning, snag lists, e-signatures, offline mode,
  i18n, accounting integration, warehouses, transfers, WAC costing, BOQ billing.
- **Do not restyle the UI.** No design system, no component library swap, no "while I was in
  there". Changes to `components/ui/` need a stated reason in the PR.
- **Do not refactor beyond the file's scope.** If you find something wrong elsewhere, note it in
  the PR and open a follow-up; do not fold it in.
- **Delete superseded code in the same PR that supersedes it.** A prototype helper left orphaned
  next to its replacement is the next person's confusion. Each build file names what it retires.

---

## 7. Definition of done

A build file is done when every one of these is true:

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build` — all green
- [ ] Every test the file asks for exists, runs in CI, and is not skipped
- [ ] Every item in the file's Verification section is checked, with real output
- [ ] Visual parity confirmed against the baseline, or the differences documented with screenshots
- [ ] The superseded prototype code is deleted
- [ ] `progress-tracker.md` and `decisions.md` updated
- [ ] Any design document the work contradicted has been amended in the same PR

"It works locally" is not done. "The tests pass but I skipped the RLS suite" is not done.

---

## 8. Testing is not optional, and RLS least of all

| Change | Required tests |
|---|---|
| New table | pgTAP policy test per role, same PR |
| New RPC | Integration test including illegal transitions and concurrency |
| Billing logic | Unit tests, **100% branch coverage** |
| New role-visible surface | pgTAP assertion that the forbidden columns are absent |
| New UI journey | Playwright test for the affected role |

Test RLS **from a client SDK session**, never from the SQL editor or `supabase db execute` —
those bypass RLS and will report a broken policy as working.

Never `.only`, `.skip` or mark flaky a test in the RLS suite. It is the highest-value test code
in this repository and it protects the product's core promise.

---

## 9. Working with the database

- All schema change is a **migration file**. Never the Supabase dashboard, in any environment.
- **Never edit an applied migration.** Fix forward.
- Every table-creating migration enables RLS, adds `force`, adds policies and indexes the policy
  columns — **in the same file.**
- Migrations are forward-only and must stay compatible with the previous code version, because
  Vercel serves old and new function versions concurrently during a rollout. Breaking changes go
  **expand → migrate → contract**.
- Money is `numeric(14,2)`, quantity `numeric(14,3)`, percentage `numeric(6,3)`. Never a float.
- Money and stock mutations go through `security definer` RPCs that take row locks. Never
  application-level read-modify-write.

---

## 10. Commits and PRs

Conventional Commits, scoped to the feature folder:

```
feat(billing): compute GST on taxable value before retention
fix(stock): lock the request row before transitioning
test(rls): assert client cannot select packages.internal_amount
```

Scopes: `projects`, `packages`, `schedule`, `updates`, `inventory`, `stock`, `approvals`,
`billing`, `users`, `auth`, `db`, `jobs`, `files`, `ci`, `docs`.

Small, reviewable commits within a build branch. Squash-merge to `main`. `main` is always
deployable.

---

## 11. Never

- Never commit a secret — including into `.env.example`, a fixture, a doc, or a test.
- Never use the `service_role` key anywhere reachable from a request path.
- Never add an Admin bypass for client certification or approval decisions.
- Never hard-code GST 18%, retention 5% or MAS 75%.
- Never use `localStorage` for anything except the theme preference.
- Never let a raw Postgres error reach the browser.
- Never claim something is verified because a handler returned success. Check the artefact.
- Never report a build as done when a test was skipped to get there. Say what failed.
