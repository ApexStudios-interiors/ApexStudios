import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * rpc_adjust_inventory's LATEST definition, read from the migrations in the
 * order Supabase applies them. A static guard that runs without a database
 * (the integration suite, which exercises the RPC for real in
 * tests/integration/stock-and-inventory.test.ts, refuses to run against
 * production — the only database). What it pins down: whichever migration
 * last redefines the RPC keeps the organisation scope added in
 * 20261008090001 AND every rule it had before — so a later migration cannot
 * silently drop either.
 */

const DIR = path.join(process.cwd(), "supabase", "migrations");
const START = /create or replace function public\.rpc_adjust_inventory\s*\(/i;

function latestDefinition(): { file: string; body: string } {
  const files = readdirSync(DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  let found: { file: string; body: string } | null = null;
  for (const file of files) {
    const sql = readFileSync(path.join(DIR, file), "utf8");
    const at = sql.search(START);
    if (at < 0) continue;
    const rest = sql.slice(at);
    const end = rest.indexOf("\n$$;");
    found = { file, body: rest.slice(0, end) };
  }
  if (!found) throw new Error("rpc_adjust_inventory is not defined in any migration");
  return found;
}

const { file, body } = latestDefinition();
const squash = (s: string) => s.replace(/\s+/g, " ");
const flat = squash(body);

describe(`rpc_adjust_inventory — latest definition (${file})`, () => {
  it("is the organisation-scoped version or later", () => {
    expect(file >= "20261008090001").toBe(true);
  });

  it("stays SECURITY DEFINER with an empty search_path", () => {
    expect(flat).toMatch(/security definer/i);
    expect(flat).toMatch(/set search_path = ''/i);
  });

  it("finds the item only within the caller's organisation (auth_org)", () => {
    expect(flat).toContain("v_org uuid := public.auth_org();");
    expect(flat).toMatch(
      /select \* into v_item from public\.inventory_items where id = p_item_id and deleted_at is null and org_id = v_org for update;/
    );
  });

  it("requires a project item's project to be the caller's organisation's too", () => {
    expect(flat).toContain(
      "if v_item.project_id is not null and not exists ( select 1 from public.projects p where p.id = v_item.project_id and p.org_id = v_org )"
    );
  });

  it("answers another organisation's item exactly like a missing one (NOT_FOUND, P0002)", () => {
    const notFound = flat.match(
      /raise exception 'NOT_FOUND: inventory item % does not exist', p_item_id using errcode = 'P0002';/g
    );
    expect(notFound).toHaveLength(2);
  });

  it("keeps the existing rules: admin only, reason required, absolute non-negative quantity", () => {
    expect(flat).toContain(
      "if not public.is_admin() then raise exception 'FORBIDDEN: rpc_adjust_inventory is admin-only'"
    );
    expect(flat).toContain("if btrim(coalesce(p_reason, '')) = '' then");
    expect(flat).toContain("if p_new_qty is null or p_new_qty < 0 then");
    expect(flat).toContain("v_delta := p_new_qty - v_item.qty_on_hand;");
    expect(flat).toContain("set qty_on_hand = p_new_qty");
  });

  it("keeps the role check before the lookup — a non-admin learns nothing about any item", () => {
    expect(flat.indexOf("public.is_admin()")).toBeLessThan(flat.indexOf("from public.inventory_items"));
  });

  it("keeps the stock movement and the audit row", () => {
    expect(flat).toContain("insert into public.stock_movements");
    expect(flat).toContain("'adjustment', p_reason, auth.uid()");
    expect(flat).toContain("perform public.fn_audit('inventory_item', v_item.id, 'adjust',");
  });

  it("is still executable by signed-in users only (revoked from public and anon)", () => {
    const sql = squash(readFileSync(path.join(DIR, file), "utf8"));
    expect(sql).toContain(
      "revoke execute on function public.rpc_adjust_inventory(uuid, numeric, text) from public, anon;"
    );
    expect(sql).toContain(
      "grant execute on function public.rpc_adjust_inventory(uuid, numeric, text) to authenticated;"
    );
  });
});
