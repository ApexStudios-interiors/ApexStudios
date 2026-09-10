import { afterAll, describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { connect } from "./db";
import * as schema from "@/db/schema";

/**
 * Drizzle drift: does db/schema still describe the database the migrations built?
 *
 * supabase/migrations/*.sql is the source of truth (AGENTS.md database rule 1).
 * Drizzle exists for typed access in service_role job handlers and for generated
 * types, and a Drizzle schema that has drifted produces types that lie — which is
 * worse than no types at all.
 *
 * `drizzle-kit generate` cannot do this check here: it diffs against its own
 * journal, and these migrations are hand-written SQL with no journal, so it would
 * report the entire schema as new every time. This compares against the live
 * catalogue instead, which is what "drift" actually means.
 */
const sql = connect();
afterAll(() => sql.end({ timeout: 5 }));

type Col = {
  table_name: string;
  column_name: string;
  data_type: string;
  numeric_precision: number | null;
  numeric_scale: number | null;
};

describe("drizzle drift", () => {
  it("every table and column in db/schema exists in the database", async () => {
    const live = (await sql`
      select table_name, column_name, data_type, numeric_precision, numeric_scale
        from information_schema.columns
       where table_schema = 'public'`) as unknown as Col[];

    const liveByTable = new Map<string, Map<string, Col>>();
    for (const c of live) {
      const bucket = liveByTable.get(c.table_name);
      if (bucket) bucket.set(c.column_name, c);
      else liveByTable.set(c.table_name, new Map([[c.column_name, c]]));
    }

    const problems: string[] = [];

    for (const value of Object.values(schema)) {
      // Only pgTable objects have a table config; enums and helpers do not.
      let config;
      try {
        config = getTableConfig(value as never);
      } catch {
        continue;
      }

      const liveCols = liveByTable.get(config.name);
      if (liveCols === undefined) {
        problems.push(`table "${config.name}" is in db/schema but not in the database`);
        continue;
      }
      for (const col of config.columns) {
        const liveCol = liveCols.get(col.name);
        if (liveCol === undefined) {
          problems.push(`column "${config.name}.${col.name}" is in db/schema but not in the database`);
          continue;
        }
        // Numeric precision and scale are the ones that matter: money is
        // numeric(14,2) and quantity numeric(14,3), and getting that wrong is
        // how a rounding bug reaches a tax invoice.
        if (liveCol.data_type === "numeric") {
          const declared = /numeric\((\d+),\s*(\d+)\)/.exec(col.getSQLType());
          if (declared) {
            const [, p, s] = declared;
            if (Number(p) !== liveCol.numeric_precision || Number(s) !== liveCol.numeric_scale) {
              problems.push(
                `column "${config.name}.${col.name}" is numeric(${p},${s}) in db/schema ` +
                  `but numeric(${liveCol.numeric_precision},${liveCol.numeric_scale}) in the database`
              );
            }
          }
        }
      }
    }

    expect(problems.join("\n")).toBe("");
  });

  it("no table in the database is missing from db/schema", async () => {
    const liveTables = (await sql`
      select c.relname as name
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`) as unknown as { name: string }[];

    const declared = new Set<string>();
    for (const value of Object.values(schema)) {
      try {
        declared.add(getTableConfig(value as never).name);
      } catch {
        /* not a table */
      }
    }

    const missing = liveTables.map((t) => t.name).filter((n) => !declared.has(n));
    expect(missing.join(", "), "tables exist in the database but not in db/schema").toBe("");
  });
});
