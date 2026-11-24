import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { packageIdFromSlug, packageSlugFromId } from "./resolve";

type Row = { id: string; name: string; seq_no: number };

/**
 * A stand-in for the RLS-scoped client: each source answers with the rows the
 * given role may read, or an RLS-style error. Only the call chain resolve.ts
 * uses (from → select → eq → [is]) is implemented.
 */
function clientFor(visible: Partial<Record<string, Row[] | "denied">>): SupabaseClient {
  return {
    from(source: string) {
      const answer = visible[source];
      const result =
        answer === "denied" || answer === undefined
          ? { data: null, error: { message: "permission denied" } }
          : { data: answer, error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        then: (resolve: (v: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

const POOL = { id: "11111111-1111-4111-8111-111111111111", name: "Swimming Pool", seq_no: 1 };
const FACADE = { id: "22222222-2222-4222-8222-222222222222", name: "Facade and Windows", seq_no: 2 };

describe("packageIdFromSlug — every role (APX-08)", () => {
  it("resolves for an admin, who reads the packages table", async () => {
    const sb = clientFor({
      packages: [POOL, FACADE],
      v_package_client: [POOL, FACADE],
      v_package_site: [POOL, FACADE],
    });
    expect(await packageIdFromSlug(sb, "p", "swimming-pool")).toBe(POOL.id);
  });

  it("resolves for a site supervisor, who can read only v_package_site", async () => {
    const sb = clientFor({ packages: [], v_package_client: "denied", v_package_site: [POOL, FACADE] });
    expect(await packageIdFromSlug(sb, "p", "swimming-pool")).toBe(POOL.id);
  });

  it("resolves for a client, who can read only v_package_client", async () => {
    const sb = clientFor({ packages: "denied", v_package_client: [POOL, FACADE], v_package_site: "denied" });
    expect(await packageIdFromSlug(sb, "p", "facade-and-windows")).toBe(FACADE.id);
  });

  it("returns null when the caller can see no package", async () => {
    const sb = clientFor({ packages: [], v_package_client: [], v_package_site: [] });
    expect(await packageIdFromSlug(sb, "p", "swimming-pool")).toBeNull();
  });

  it("does not treat the same package from two sources as a name clash", async () => {
    const sb = clientFor({ packages: [POOL], v_package_client: [POOL], v_package_site: [POOL] });
    expect(await packageSlugFromId(sb, "p", POOL.id)).toBe("swimming-pool");
  });
});
