import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * The layering rules in ../AGENTS.md are only real if a machine checks them.
 * Every rule below names the document rule it enforces — a lint error whose
 * reason is unknowable gets disabled by the next person in a hurry.
 */
/** Anything that reaches Postgres without the user's JWT, and so without RLS. */
const RLS_BYPASS = [
  {
    group: ["drizzle-orm", "drizzle-orm/*", "postgres", "@/db", "@/db/*"],
    message:
      "D11: Drizzle and direct Postgres bypass RLS. Use the Supabase client bound to the user's JWT (lib/supabase/server), or an rpc_* function. Drizzle belongs in db/** and lib/jobs/handlers/** only.",
  },
  {
    group: ["@/lib/supabase/admin", "**/lib/supabase/admin"],
    message:
      "architecture.md §4.1: the service_role client bypasses RLS. It belongs in lib/jobs/handlers/**, lib/jobs/runner.ts, app/api/backup/report/route.ts and lib/auth/admin.ts only — the paths this rule's own `ignores` list actually exempts.",
  },
];

/** The same RLS_BYPASS patterns, shaped for @typescript-eslint/no-restricted-imports
 *  (which understands `allowTypeImports`, unlike core no-restricted-imports). */
const RLS_BYPASS_TS = RLS_BYPASS.map((p) => ({ ...p, allowTypeImports: false }));

/** service.ts stays framework-free so the domain can be lifted out (HLD §4.2). */
const NO_FRAMEWORK = [
  {
    group: ["next", "next/*", "server-only"],
    message:
      "HLD §4.3: service.ts must never import from next/* or server-only. Move the framework concern into actions.ts or queries.ts.",
  },
];

/**
 * Components take props; they never reach the data layer themselves.
 *
 * `allowTypeImports: true` — a component still needs a query's DTO TYPE for
 * its own prop shape (build/04-projects-packages-phases.md §4.4 step 5: "a
 * discriminated union on role" typed against exactly what the query
 * returns). A type-only import is erased at compile time; there is no
 * runtime call into queries.ts for the rule to actually be guarding against.
 * This needs @typescript-eslint/no-restricted-imports — the core ESLint rule
 * has no such option and would block the type import too.
 */
const NO_DATA_LAYER = [
  {
    group: ["**/features/*/queries", "@/features/*/queries"],
    message:
      "code-standards §1: components never query the database. Take the data as a prop from a Server Component that called queries.ts.",
    allowTypeImports: true,
  },
];

/**
 * The three banned globals, one constant each.
 *
 * no-restricted-globals is set in more than one block (a file-scoped override
 * has to re-list every restriction it still wants — see the comment on the
 * override blocks below), and flat config REPLACES rather than merges. Naming
 * each restriction once is what stops an override re-typing a message slightly
 * differently, or silently dropping one.
 */
/** AGENTS.md Money display / code-standards §6. */
const NO_INTL = { name: "Intl", message: "AGENTS.md: currency formatting lives in lib/money." };
/** AGENTS.md Do not: the theme preference is the only storage use allowed. */
const NO_LOCAL_STORAGE = {
  name: "localStorage",
  message: "AGENTS.md: localStorage is for the theme preference only.",
};
const NO_SESSION_STORAGE = {
  name: "sessionStorage",
  message: "AGENTS.md: sessionStorage is not used in this application.",
};

/** The four trees both money rules cover: everything that renders. */
const UI_TREES = [
  "app/**/*.{ts,tsx}",
  "components/**/*.{ts,tsx}",
  "features/**/*.{ts,tsx}",
  "context/**/*.{ts,tsx}",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // Frozen prototype copies and design documents; deliberately not wired in.
    "docs/**",
    // Claude Code agent worktrees are full checkouts of this repo nested inside
    // it, and vendored skills are tooling. Linting them reported ~100+ errors
    // from copies of the repo itself, masking the real result.
    ".claude/**",
    ".agents/**",
    "supabase/.temp/**",
  ]),

  // ── AGENTS.md Conventions: "No `any`. No non-null assertion (`!`) — narrow
  //    properly." Both are errors, not warnings.
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
    },
  },

  // ── D11 (docs/decisions.md): user-context data access goes through the
  //    Supabase client so RLS applies. A Drizzle query or a direct Postgres
  //    connection in a request path authenticates as a privileged role and
  //    bypasses RLS entirely, which would make every policy decorative.
  //    docs/architecture.md §4.1: the service_role client bypasses RLS too.
  //
  //    ESLint flat config REPLACES rule options rather than merging them, so
  //    every block that sets no-restricted-imports must repeat the base
  //    patterns. Composing them from these constants is what stops a narrower
  //    block from silently switching the D11 rule off.
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "db/**",
      "lib/jobs/handlers/**",
      // The claim/finish/reap primitives (rpc_claim_jobs, rpc_finish_job, and
      // a plain reap update) are all service_role-only by design (migration
      // 0012's own grants) — a cron invocation authenticates via
      // CRON_SECRET, not a Supabase session, so it has no RLS-scoped identity
      // to act as. This is the same "background jobs run as service_role"
      // carve-out lib/supabase/admin.ts documents, just not literally inside
      // handlers/ — build/06-files-jobs-daily-updates.md's own layout puts
      // the runner one level up from its handlers.
      "lib/jobs/runner.ts",
      // Same reasoning as lib/jobs/runner.ts, one door over: called only by
      // .github/workflows/backup-nightly.yml (Bearer CRON_SECRET, checked
      // first thing), never by a user session, to record an outcome in
      // `jobs` — a table with no user-writable path at all.
      "app/api/backup/report/route.ts",
      // GoTrue's admin API (create/delete a sign-in) has no RLS-scoped
      // equivalent — auth.users is not a PostgREST table. This file is the one
      // lib/supabase/admin.ts and build/03-auth-and-rbac.md §2.10 name for it,
      // and it touches no application table: the profiles row is written by
      // features/users/actions.ts through the user's own RLS-scoped client.
      "lib/auth/admin.ts",
      "drizzle.config.ts",
      // The health probe issues `select 1` and reads no application data, so
      // there is nothing for RLS to protect. It is listed here rather than
      // silenced inline, so the exemption is visible next to the rule.
      "app/api/health/route.ts",
      // Integration tests connect directly ON PURPOSE. They exercise
      // constraints, triggers and RPC concurrency, which are properties of the
      // database itself and are invisible from a user session. The drift test
      // additionally has to import db/schema, because comparing the schema to
      // the database is the whole point of it.
      //
      // This exemption does NOT cover RLS testing. AGENTS.md database rule 8
      // stands: policies are tested from a real client SDK session, never from a
      // privileged connection, because a privileged connection reports a broken
      // policy as working. Those live in supabase/tests (pgTAP).
      "tests/integration/**",
      // Its own journeys run through real signed-in Playwright sessions, same
      // as every other e2e spec — the direct connection here is TEST CLEANUP
      // only (deleting the project the admin journey creates), not part of
      // any assertion. Scoped to this one file rather than e2e/** so the rule
      // still holds everywhere an e2e spec might be tempted to skip the real
      // session for convenience.
      "e2e/packages-journey.spec.ts",
      // Same exemption, same reason: the site journey's progress mutation has
      // a real commercial side effect (a phase's billing_status) that no
      // client-session call can undo (D21's soft-delete RETURNING gotcha
      // applies here too), and the admin journey's cleanup just deletes the
      // task row it created. Every assertion still runs through a real
      // signed-in session.
      "e2e/schedule-journey.spec.ts",
      // Same exemption: TEST CLEANUP only (deleting the daily update the
      // site journey creates). Every assertion runs through a real
      // signed-in session.
      "e2e/updates-journey.spec.ts",
      // Same exemption, same reason: seeding a throwaway pending stock
      // request directly (so the reject/bell journeys don't depend on the
      // seed's own two pending rows) and cleaning up afterwards. Every
      // assertion — including the lifecycle journey's own multi-role
      // transitions — runs through a real signed-in session via the UI.
      "e2e/stock-inventory-journey.spec.ts",
      // Same exemption, same reason: seeding throwaway pending/rejected
      // approvals and a fixture attachment row directly (so the approve,
      // reject and supersession journeys don't depend on ordering against
      // the seed's own five approvals), and cleaning up afterwards. Every
      // assertion — including the client's mobile-viewport lightbox and
      // decision journey — runs through a real signed-in session via the UI.
      "e2e/approvals-journey.spec.ts",
      // Same exemption, same reason: seeding a throwaway billable phase and
      // delivered material (admin journey) and a pre-submitted bill (client
      // journey) directly, and draining the real bill.pdf job's own drift is
      // read back directly too (there is no UI surface for a job's status).
      // Every certification/approval assertion still runs through a real
      // signed-in session via the UI.
      "e2e/billing-journey.spec.ts",
    ],
    rules: { "no-restricted-imports": ["error", { patterns: [...RLS_BYPASS] }] },
  },

  // ── docs/01-hld.md §4.3 and code-standards §1: service.ts is pure business
  //    logic, testable against a plain connection. It must stay framework-free
  //    so the domain can be lifted into a standalone service (HLD §4.2).
  {
    files: ["features/*/service.ts", "features/*/service.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...RLS_BYPASS, ...NO_FRAMEWORK] }],
    },
  },

  // ── code-standards §1: components take props. Data comes from queries.ts
  //    through a Server Component. A component that reaches the database has
  //    no role context and no place to enforce one.
  //
  //    Covers both components/** (the generic ui/layout/auth/upload/shared
  //    primitives) and features/*/components/** (each module's own dialogs
  //    and widgets, since the modularization pass) — a moved dialog is still
  //    a component and this rule still applies to it.
  {
    files: ["components/**/*.{ts,tsx}", "features/*/components/**/*.{ts,tsx}"],
    rules: {
      // core no-restricted-imports has no allowTypeImports; disabled here so
      // the @typescript-eslint version (which does) is the only one active.
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [...RLS_BYPASS_TS, ...NO_DATA_LAYER] },
      ],
    },
  },

  // ── MODULARIZATION_REPORT.md / MIGRATION_PLAN.md: feature-specific
  //    components live in features/<domain>/components/ now. components/domain
  //    and components/dialogs no longer exist — this stops either flat
  //    directory from being quietly recreated by a future PR.
  //
  //    The `/**/*.*` shape is load-bearing, not decoration. @eslint/config-array
  //    treats any pattern ending in `/*` or `/**` as UNIVERSAL
  //    (universalPattern = /^\*$|^!|\/\*{1,2}$/u), and a universal-only match
  //    never sets matchFound — the file comes back UNCONFIGURED and is skipped
  //    entirely. With the bare `components/domain/**` this rule fired only
  //    because a different block (files: ["**/*.{ts,tsx,mts}"]) happened to
  //    match the same path non-universally; anything outside those extensions
  //    slipped through silently. `**/*.*` is non-universal, so this block
  //    stands on its own.
  //
  //    A .tsx dropped here — the realistic regression — gets the message
  //    below. A non-JS file (.css, .md) fails on a parse error instead, since
  //    there is no parser for it: a blunter failure, but still a failure,
  //    which is the point. The directory must not come back, in any form.
  {
    files: ["components/domain/**/*.*", "components/dialogs/**/*.*"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Program",
          message:
            "MODULARIZATION_REPORT.md: feature-specific components belong in features/<domain>/components/, not components/domain or components/dialogs. Genuinely cross-module components belong in components/shared/.",
        },
      ],
    },
  },

  // ── AGENTS.md Money display / code-standards §6: always formatINR() or
  //    formatINRCompact() from lib/money. Indian digit grouping is not what
  //    toLocaleString gives you by default, and two formatters drift.
  {
    files: UI_TREES,
    ignores: [
      // TODO(build-07): these two format quantities, not money. They move to
      // a shared quantity formatter when the inventory and stock surfaces are
      // migrated. Listed explicitly so the exemption cannot quietly spread.
      "features/stock/components/ReqTable.tsx",
      "features/inventory/components/InventoryTable.tsx",
      // Generated by `shadcn add calendar`. Its toLocaleString formats month
      // and weekday NAMES for the date picker — no money passes through it,
      // and the rule exists to stop two currency formatters drifting apart.
      // Left unmodified so `shadcn add` can regenerate it without a conflict.
      "components/ui/calendar.tsx",
    ],
    rules: {
      "no-restricted-properties": [
        "error",
        {
          property: "toLocaleString",
          message:
            "AGENTS.md: use formatINR() / formatINRCompact() from lib/money. Never an inline toLocaleString.",
        },
      ],
    },
  },

  // ── All three banned globals — `Intl` (AGENTS.md Money display) and
  //    localStorage/sessionStorage (AGENTS.md Do not) — over the four trees, in
  //    ONE entry with NO `ignores`.
  //
  //    They used to be two blocks with identical `files` patterns. ESLint flat
  //    config REPLACES rule options rather than merging them (the same trap the
  //    D11 comment above warns about), so for every file both blocks matched —
  //    which was all of them — the later localStorage block won outright and
  //    the `Intl` ban was silently never enforced. Verified before and after
  //    with `eslint --stdin --stdin-filename`.
  //
  //    This block bans all three everywhere. The single file-scoped exemption
  //    is the override below, which re-permits ONE global for TWO named files
  //    and re-lists the other two so they stay enforced there. Anything that
  //    sets no-restricted-globals must do the same: list every restriction it
  //    still wants, or it turns the rest off for those files.
  {
    files: UI_TREES,
    rules: {
      "no-restricted-globals": ["error", NO_INTL, NO_LOCAL_STORAGE, NO_SESSION_STORAGE],
    },
  },

  // ── The theme preference is the one storage use AGENTS.md allows, and
  //    `components/ui/ThemeToggle.tsx` is the only file that makes it in real
  //    code (`localStorage.setItem("theme", next)`). So it gets `localStorage`
  //    back — and NOTHING else. `Intl` and `sessionStorage` are RE-LISTED, not
  //    inherited: a block that sets no-restricted-globals replaces the options
  //    wholesale, so omitting them here would switch them off for this file and
  //    recreate, in miniature, the bug the block above exists to fix.
  //
  //    `app/layout.tsx` was on the old exemption list and is deliberately NOT
  //    here. Its `localStorage` lives inside the THEME_INIT_SCRIPT template
  //    string, and no-restricted-globals matches identifiers, never string
  //    contents — so the exemption never did anything. Removing it changes no
  //    result today (verified by probe) and means a real `localStorage` call
  //    added to that file in future gets caught like anywhere else.
  {
    files: ["components/ui/ThemeToggle.tsx"],
    rules: {
      "no-restricted-globals": ["error", NO_INTL, NO_SESSION_STORAGE],
    },
  },

  // NOTE — no override for `features/stock/components/ReqTable.tsx`,
  // `features/inventory/components/InventoryTable.tsx` or
  // `components/ui/calendar.tsx`. They are exempt from the `toLocaleString`
  // block above, which is `no-restricted-properties` — a DIFFERENT rule. None
  // of the three touches a banned global, so all three stay fully covered here.
  // If `shadcn add calendar` ever regenerates calendar.tsx using `Intl`, that
  // should surface as a lint failure for a human to decide on, not be
  // pre-permitted now.

  // Prettier last: it only turns off stylistic rules that would fight it.
  prettier,
]);

export default eslintConfig;
