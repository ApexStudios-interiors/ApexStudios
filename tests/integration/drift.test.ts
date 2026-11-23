import { afterAll, describe, expect, it } from "vitest";
import { getTableConfig, isPgEnum } from "drizzle-orm/pg-core";
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

  // APX-53: the first test only walks db/schema, so a column added by a
  // migration and never mirrored (projects.completed_at was one) passed
  // silently. This is the other direction, column by column.
  it("every column in the database exists in db/schema", async () => {
    const live = (await sql`
      select c.table_name, c.column_name
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public' and t.table_type = 'BASE TABLE'`) as unknown as Pick<
      Col,
      "table_name" | "column_name"
    >[];

    const declared = new Map<string, Set<string>>();
    for (const value of Object.values(schema)) {
      let config;
      try {
        config = getTableConfig(value as never);
      } catch {
        continue;
      }
      declared.set(config.name, new Set(config.columns.map((c) => c.name)));
    }

    const missing = live
      .filter((c) => {
        const cols = declared.get(c.table_name);
        // A table missing outright is the next test's failure, not this one's.
        return cols !== undefined && !cols.has(c.column_name);
      })
      .map((c) => `${c.table_name}.${c.column_name}`);
    expect(missing.join(", "), "columns exist in the database but not in db/schema").toBe("");
  });

  it("every enum in db/schema has exactly the database's values, in order", async () => {
    const live = (await sql`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_type t
        join pg_enum e on e.enumtypid = t.oid
        join pg_namespace n on n.oid = t.typnamespace
       where n.nspname = 'public'
       group by t.typname`) as unknown as { name: string; labels: string[] }[];
    const liveByName = new Map(live.map((e) => [e.name, e.labels]));

    const problems: string[] = [];
    const declared = new Set<string>();
    for (const value of Object.values(schema)) {
      if (!isPgEnum(value)) continue;
      declared.add(value.enumName);
      const labels = liveByName.get(value.enumName);
      if (labels === undefined) {
        problems.push(`enum "${value.enumName}" is in db/schema but not in the database`);
      } else if (labels.join(",") !== value.enumValues.join(",")) {
        problems.push(
          `enum "${value.enumName}" is [${value.enumValues.join(", ")}] in db/schema ` +
            `but [${labels.join(", ")}] in the database`
        );
      }
    }
    for (const name of liveByName.keys()) {
      if (!declared.has(name)) problems.push(`enum "${name}" is in the database but not in db/schema`);
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
