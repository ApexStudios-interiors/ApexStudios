import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The approval sample-photo guard (20261008090002), read from the migrations
 * as Supabase applies them — a static check that runs without a database
 * (the integration suite, tests/integration/approvals.test.ts, exercises the
 * trigger for real but refuses to run against production, the only
 * database). Pins down: the LATEST trg_attachments_check_approval keeps the
 * per-approval lock, the count taken after it, the cap of four with
 * requestUploadFor's own words, the admin/site role test, the retried-confirm
 * pass-through, and that it touches approval rows only — and the trigger is
 * still attached before insert.
 */

const DIR = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(DIR)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort();

function latest(pattern: RegExp): { file: string; text: string } {
  let found: { file: string; text: string } | null = null;
  for (const file of files) {
    const text = readFileSync(path.join(DIR, file), "utf8");
    const at = text.search(pattern);
    if (at < 0) continue;
    const rest = text.slice(at);
    found = { file, text: rest.slice(0, rest.indexOf("\n$$;")) };
  }
  if (!found) throw new Error(`no migration matches ${pattern}`);
  return found;
}

const squash = (s: string) => s.replace(/\s+/g, " ");
const fn = latest(/create or replace function public\.trg_attachments_check_approval\s*\(/i);
const body = squash(fn.text);

describe(`trg_attachments_check_approval — latest definition (${fn.file})`, () => {
  it("is SECURITY DEFINER with an empty search_path", () => {
    expect(body).toMatch(/security definer set search_path = ''/i);
  });

  it("touches approval photos only", () => {
    expect(body).toContain("if new.entity_type <> 'approval' then return new; end if;");
  });

  it("refuses a signed-in caller who is not admin or site", () => {
    expect(body).toContain("if v_role is null or v_role not in ('admin', 'site') then");
    expect(body).toContain("FORBIDDEN: only admin or site may add sample photos to an approval");
  });

  it("serialises inserts per approval id BEFORE counting", () => {
    const lock = body.indexOf(
      "perform pg_advisory_xact_lock(hashtextextended('attachments.approval:' || new.entity_id::text, 0));"
    );
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(body.indexOf("select count(*) into v_live_photos"));
  });

  it("lets a retried confirm (same r2_key) through to the unique key, after the lock and before the cap", () => {
    const pass = body.indexOf(
      "if exists (select 1 from public.attachments a where a.r2_key = new.r2_key) then return new;"
    );
    expect(pass).toBeGreaterThan(body.indexOf("pg_advisory_xact_lock"));
    expect(pass).toBeLessThan(body.indexOf("if v_live_photos >= 4 then"));
  });

  it("caps live photos at four, with requestUploadFor's own words", () => {
    expect(body).toContain(
      "where a.entity_type = 'approval' and a.entity_id = new.entity_id and a.deleted_at is null;"
    );
    expect(body).toContain(
      "if v_live_photos >= 4 then raise exception 'REASON_REQUIRED: this approval already has 4 attachments' using errcode = '23514';"
    );
  });
});

describe("trg_attachments_approval — still attached", () => {
  it("fires before every insert on attachments", () => {
    const all = files.map((f) => squash(readFileSync(path.join(DIR, f), "utf8"))).join(" ");
    expect(all).toContain(
      "create trigger trg_attachments_approval before insert on public.attachments for each row execute function public.trg_attachments_check_approval();"
    );
    expect(all).not.toMatch(/drop trigger (if exists )?trg_attachments_approval/i);
  });
});
