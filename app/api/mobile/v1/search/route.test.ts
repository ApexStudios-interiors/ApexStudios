import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), any signed-in role, `q` trimmed and checked by the web's
 * own searchAllSchema (real, not mocked) — under two characters is an empty
 * result with no search — the shared searchFor called with the
 * authenticated session only, each result reshaped to
 * `{ type, id, title, subtitle, projectId }` (no web href), no-store, and
 * errors mapped with mapDomainError's copy (the rate limit 429). What each
 * role can find is searchAll's own scoping, tested in
 * features/search/queries.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireSession: vi.fn(),
    searchFor: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireSession: h.requireSession,
  requireRole: vi.fn(),
  requireProjectAccess: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/search/run", () => ({ searchFor: h.searchFor }));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

/** Results as searchFor returns them (the web's DTO). */
const FOUND = [
  {
    id: PROJECT_ID,
    category: "Projects",
    text: "Tile House",
    sub: "Hyderabad",
    href: `/projects/${PROJECT_ID}`,
    projectId: PROJECT_ID,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a9",
    category: "Approvals",
    text: "Tile sample",
    sub: "Tile House",
    href: `/projects/${PROJECT_ID}/approvals`,
    projectId: PROJECT_ID,
  },
];

function search(q?: string) {
  const url =
    q === undefined
      ? "http://localhost/api/mobile/v1/search"
      : `http://localhost/api/mobile/v1/search?q=${encodeURIComponent(q)}`;
  return GET(new Request(url));
}

async function expectError(res: Response, status: number, error: string, message: string | RegExp) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const body = await res.json();
  expect(body.error).toBe(error);
  if (typeof message === "string") expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
  expect(Object.keys(body).sort()).toEqual(["error", "message"]);
}

beforeEach(() => {
  h.bearerToken = "mobile-token";
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("site"));
  h.searchFor.mockReset();
  h.searchFor.mockResolvedValue(FOUND);
});

describe("GET /api/mobile/v1/search", () => {
  it("returns { results: [{ type, id, title, subtitle, projectId }] } (200, no-store)", async () => {
    const res = await search("tile");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      results: [
        {
          type: "Projects",
          id: PROJECT_ID,
          title: "Tile House",
          subtitle: "Hyderabad",
          projectId: PROJECT_ID,
        },
        {
          type: "Approvals",
          id: "00000000-0000-4000-8000-0000000000a9",
          title: "Tile sample",
          subtitle: "Tile House",
          projectId: PROJECT_ID,
        },
      ],
    });
  });

  it("never sends the web's href", async () => {
    const body = await (await search("tile")).json();

    for (const r of body.results) expect(r).not.toHaveProperty("href");
  });

  it.each(["admin", "site", "client"] as const)(
    "searches as %s with that session — what it can find is the session's scoping",
    async (role) => {
      const session = sessionAs(role);
      h.requireSession.mockResolvedValue(session);

      const res = await search("tile");

      expect(res.status).toBe(200);
      expect(h.searchFor).toHaveBeenCalledExactlyOnceWith(session, "tile");
    }
  );

  it("ignores any role or user the request names — only the session counts", async () => {
    const session = sessionAs("client");
    h.requireSession.mockResolvedValue(session);

    await GET(new Request("http://localhost/api/mobile/v1/search?q=tile&role=admin&userId=x"));

    expect(h.searchFor).toHaveBeenCalledExactlyOnceWith(session, "tile");
  });

  it("trims the query", async () => {
    await search("   tile   ");

    expect(h.searchFor).toHaveBeenCalledExactlyOnceWith(expect.anything(), "tile");
  });

  it.each([
    ["no q at all", undefined],
    ["an empty q", ""],
    ["a whitespace q", "    "],
    ["a single character", "t"],
    ["a single character in whitespace", "  t  "],
  ])("returns { results: [] } for %s, without searching", async (_label, q) => {
    const res = await search(q);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ results: [] });
    expect(h.searchFor).not.toHaveBeenCalled();
  });

  it("returns an empty list when nothing matches", async () => {
    h.searchFor.mockResolvedValue([]);

    expect(await (await search("zzz")).json()).toEqual({ results: [] });
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await search("tile");

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.searchFor).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await search("tile");

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.searchFor).not.toHaveBeenCalled();
  });

  it("returns 429 with the existing copy once the shared rate limit is reached", async () => {
    h.searchFor.mockRejectedValue(new Error("RATE_LIMITED: too many searches, slow down"));

    const res = await search("tile");

    await expectError(res, 429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.searchFor.mockRejectedValue(new Error('relation "projects" does not exist'));

    const res = await search("tile");

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    consoleError.mockRestore();
  });
});
