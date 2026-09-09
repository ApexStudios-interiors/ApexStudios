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
      "architecture.md §4.1: the service_role client bypasses RLS. It belongs in lib/jobs/handlers/** and lib/auth/admin.ts only.",
  },
];

/** service.ts stays framework-free so the domain can be lifted out (HLD §4.2). */
const NO_FRAMEWORK = [
  {
    group: ["next", "next/*", "server-only"],
    message:
      "HLD §4.3: service.ts must never import from next/* or server-only. Move the framework concern into actions.ts or queries.ts.",
  },
];

/** Components take props; they never reach the data layer themselves. */
const NO_DATA_LAYER = [
  {
    group: ["**/features/*/queries", "@/features/*/queries"],
    message:
      "code-standards §1: components never query the database. Take the data as a prop from a Server Component that called queries.ts.",
  },
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
  {
    files: ["components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...RLS_BYPASS, ...NO_DATA_LAYER] }],
    },
  },

  // ── AGENTS.md Money display / code-standards §6: always formatINR() or
  //    formatINRCompact() from lib/money. Indian digit grouping is not what
  //    toLocaleString gives you by default, and two formatters drift.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "features/**/*.{ts,tsx}",
      "context/**/*.{ts,tsx}",
    ],
    ignores: [
      // TODO(build-07): these three format quantities, not money. They move to
      // a shared quantity formatter when the inventory and stock surfaces are
      // migrated. Listed explicitly so the exemption cannot quietly spread.
      "components/domain/ReqTable.tsx",
      "components/domain/InventoryTable.tsx",
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
      "no-restricted-globals": [
        "error",
        { name: "Intl", message: "AGENTS.md: currency formatting lives in lib/money." },
      ],
    },
  },

  // ── AGENTS.md Do not: localStorage/sessionStorage are for the theme only.
  {
    files: [
      "app/**/*.{ts,tsx}",
      "components/**/*.{ts,tsx}",
      "features/**/*.{ts,tsx}",
      "context/**/*.{ts,tsx}",
    ],
    ignores: ["app/layout.tsx", "components/ui/ThemeToggle.tsx"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "localStorage", message: "AGENTS.md: localStorage is for the theme preference only." },
        { name: "sessionStorage", message: "AGENTS.md: sessionStorage is not used in this application." },
      ],
    },
  },

  // Prettier last: it only turns off stylistic rules that would fight it.
  prettier,
]);

export default eslintConfig;
