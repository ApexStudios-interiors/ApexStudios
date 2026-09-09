import { expect } from "vitest";

/**
 * Narrows a query result to its single row, failing the test with a useful
 * message instead of a TypeError when the query returned nothing.
 *
 * `../AGENTS.md` forbids the non-null assertion, in tests as well as in
 * application code: `rows[0]!.status` on an empty result throws "cannot read
 * property of undefined", which tells you nothing about which query failed.
 */
export function one<T>(rows: readonly T[], what: string): T {
  const row = rows[0];
  expect(row, `expected one ${what}, got ${rows.length} rows`).toBeDefined();
  if (row === undefined) throw new Error(`expected one ${what}`);
  return row;
}
