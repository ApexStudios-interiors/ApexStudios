import { afterEach, describe, expect, it, vi } from "vitest";
import { checkProductionTarget, projectRefFromUrl } from "../scripts/lib/db-target.mjs";

/**
 * The one guard that stands between a mistyped connection string and the live
 * database (docs/decisions.md D49). CI no longer runs on pull requests, so this
 * is the only place the guard is exercised automatically — it is worth more
 * than the twenty lines it tests.
 */

// Shaped like a real project ref (20 lowercase letters), deliberately not one:
// the repository names secrets and never carries their values.
const PROD = "qqqqprodprojectrefq";
const OTHER = "abcdefghijklmnopqrst";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("projectRefFromUrl", () => {
  it("reads the ref out of a direct connection string", () => {
    expect(projectRefFromUrl(`postgresql://postgres:pw@db.${PROD}.supabase.co:5432/postgres`)).toBe(PROD);
  });

  it("reads the ref out of a pooled connection string, where it is in the username", () => {
    expect(
      projectRefFromUrl(`postgresql://postgres.${PROD}:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`)
    ).toBe(PROD);
  });

  it("reads the ref out of an API URL", () => {
    expect(projectRefFromUrl(`https://${PROD}.supabase.co`)).toBe(PROD);
  });

  it("returns null for a URL with no Supabase project in it", () => {
    expect(projectRefFromUrl("postgresql://postgres:pw@localhost:5432/postgres")).toBeNull();
    expect(projectRefFromUrl(undefined)).toBeNull();
  });
});

describe("checkProductionTarget", () => {
  it("refuses a database URL that resolves to the production ref", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", PROD);
    const { refuse } = checkProductionTarget(
      [`postgresql://postgres.${PROD}:pw@aws-0-ap-south-1.pooler.supabase.com:6543/postgres`],
      "the seed"
    );
    expect(refuse).toContain("Refusing to run the seed");
    expect(refuse).toContain(PROD);
  });

  it("refuses when any one target is production, not just the first", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", PROD);
    const { refuse } = checkProductionTarget(
      [`postgresql://postgres:pw@db.${OTHER}.supabase.co:5432/postgres`, `https://${PROD}.supabase.co`],
      "the integration tests"
    );
    // The half that would still have mutated production: a non-production
    // database URL paired with the live API URL.
    expect(refuse).not.toBeNull();
  });

  it("refuses a bare project ref, which is what db:reset has to check", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", PROD);
    expect(checkProductionTarget([PROD], "a database reset").refuse).not.toBeNull();
  });

  it("allows a target on a different project", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", PROD);
    const result = checkProductionTarget(
      [`postgresql://postgres:pw@db.${OTHER}.supabase.co:5432/postgres`, `https://${OTHER}.supabase.co`],
      "the seed"
    );
    expect(result).toEqual({ refuse: null, warn: null });
  });

  it("fails closed when the production ref is not configured and nobody is watching", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", "");
    vi.stubEnv("CI", "1");
    const { refuse } = checkProductionTarget(["postgresql://postgres:pw@db.example.com:5432/x"], "the seed");
    expect(refuse).toContain("SUPABASE_PROD_PROJECT_REF is not set");
  });

  it("allows a throwaway local stack with no production ref configured (CI's database job)", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", "");
    vi.stubEnv("CI", "1");
    const result = checkProductionTarget(
      ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", "http://127.0.0.1:54321"],
      "the integration tests"
    );
    expect(result).toEqual({ refuse: null, warn: null });
    expect(
      checkProductionTarget(["postgresql://postgres:pw@localhost:5432/x"], "the seed").refuse
    ).toBeNull();
  });

  it("does not treat a local database paired with a remote API URL as local", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", "");
    vi.stubEnv("CI", "1");
    const { refuse } = checkProductionTarget(
      ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", `https://${PROD}.supabase.co`],
      "the integration tests"
    );
    expect(refuse).toContain("SUPABASE_PROD_PROJECT_REF is not set");
  });

  it("does not treat a tunnel to a hosted pooler on localhost as local", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", "");
    vi.stubEnv("CI", "1");
    expect(
      checkProductionTarget([`postgresql://postgres.${PROD}:pw@127.0.0.1:6543/postgres`], "the seed").refuse
    ).not.toBeNull();
  });

  it("does not treat a bare project ref as local", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", "");
    vi.stubEnv("CI", "1");
    expect(checkProductionTarget([OTHER], "a database reset").refuse).not.toBeNull();
  });

  it("still refuses the production ref when it is configured, local stack or not", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", PROD);
    const { refuse } = checkProductionTarget(
      ["postgresql://postgres:postgres@127.0.0.1:54322/postgres", `https://${PROD}.supabase.co`],
      "the integration tests"
    );
    expect(refuse).toContain(`Refusing to run the integration tests against ${PROD}`);
  });

  it("treats a placeholder ref as no ref at all", () => {
    vi.stubEnv("SUPABASE_PROD_PROJECT_REF", "your-project-ref-placeholder");
    vi.stubEnv("CI", "1");
    expect(checkProductionTarget([`https://${PROD}.supabase.co`], "the seed").refuse).toContain(
      "cannot prove its target is not the"
    );
  });
});
