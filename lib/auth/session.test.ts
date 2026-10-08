import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * getSession() over both transports, with the REAL lib/supabase/server.ts and
 * lib/auth/session.ts and only their boundaries faked: the request
 * (next/headers), GoTrue + PostgREST (@supabase/ssr), and the preview cookie's
 * HMAC (lib/auth/impersonation, which needs server env to sign).
 *
 * What it pins down: a Bearer header becomes the client's Authorization and is
 * handed to getClaims() explicitly; the profile/is_active check still applies;
 * a bearer request never consults apex_preview; and the cookie path a web
 * request takes is unchanged.
 */

type ClientOptions = {
  cookies: { getAll(): unknown[] };
  global: { headers?: Record<string, string> };
};
type Profile = { org_id: string; role: string; full_name: string; email: string | null; is_active: boolean };

const h = vi.hoisted(() => ({
  requestHeaders: new Headers(),
  requestCookies: [] as { name: string; value: string }[],
  clientOptions: [] as ClientOptions[],
  getClaims: vi.fn(),
  profile: null as Profile | null,
  decodePreviewCookie: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => h.requestHeaders,
  cookies: async () => ({
    getAll: () => h.requestCookies,
    get: (name: string) => h.requestCookies.find((c) => c.name === name),
    set: vi.fn(),
  }),
}));
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
  },
}));
vi.mock("@/lib/auth/impersonation", () => ({
  PREVIEW_COOKIE_NAME: "apex_preview",
  decodePreviewCookie: h.decodePreviewCookie,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: ClientOptions) => {
    h.clientOptions.push(options);
    return {
      auth: { getClaims: h.getClaims },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: h.profile, error: h.profile ? null : { message: "none" } }),
          }),
        }),
      }),
    };
  },
}));

const { getSession, requireSession, UnauthenticatedError } = await import("./session");

const USER_ID = "00000000-0000-4000-8000-0000000000d1";
const ORG = "00000000-0000-4000-8000-0000000000a0";
const PROJECT = "00000000-0000-4000-8000-0000000000b1";

function claimsFor(role: string) {
  return {
    data: { claims: { sub: USER_ID, email: "x@beapex.in", app_metadata: { app_role: role, org_id: ORG } } },
    error: null,
  };
}

function profileAs(role: string, isActive = true) {
  h.profile = { org_id: ORG, role, full_name: "Test User", email: "x@beapex.in", is_active: isActive };
}

beforeEach(() => {
  h.requestHeaders = new Headers();
  h.requestCookies = [];
  h.clientOptions = [];
  h.getClaims.mockReset();
  h.decodePreviewCookie.mockReset();
  h.decodePreviewCookie.mockReturnValue({ role: "site", projectId: PROJECT, issuedAt: Date.now() });
  profileAs("site");
});

describe("getSession — bearer token", () => {
  it("accepts a valid bearer token: sent as Authorization and verified by getClaims(token)", async () => {
    h.requestHeaders = new Headers({ authorization: "Bearer mobile-token" });
    h.getClaims.mockResolvedValue(claimsFor("site"));

    const session = await getSession();

    expect(h.getClaims).toHaveBeenCalledWith("mobile-token");
    expect(h.clientOptions[0]?.global.headers).toEqual({ Authorization: "Bearer mobile-token" });
    // No cookie store: nothing from the request's cookies reaches the client.
    h.requestCookies = [{ name: "sb-access-token", value: "cookie-token" }];
    expect(h.clientOptions[0]?.cookies.getAll()).toEqual([]);
    expect(session).toEqual({
      userId: USER_ID,
      orgId: ORG,
      role: "site",
      fullName: "Test User",
      email: "x@beapex.in",
      impersonating: null,
    });
  });

  it("returns 401 (UNAUTHENTICATED) for a bearer token getClaims rejects", async () => {
    h.requestHeaders = new Headers({ authorization: "Bearer expired-token" });
    h.getClaims.mockResolvedValue({ data: null, error: { message: "invalid JWT" } });

    await expect(requireSession()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("returns 401 (UNAUTHENTICATED) for a valid token whose profile is inactive", async () => {
    h.requestHeaders = new Headers({ authorization: "Bearer mobile-token" });
    h.getClaims.mockResolvedValue(claimsFor("site"));
    profileAs("site", false);

    expect(await getSession()).toBeNull();
    await expect(requireSession()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("never reads the apex_preview cookie for a bearer request, even for an admin", async () => {
    h.requestHeaders = new Headers({ authorization: "Bearer mobile-token" });
    h.requestCookies = [{ name: "apex_preview", value: "signed-preview" }];
    h.getClaims.mockResolvedValue(claimsFor("admin"));
    profileAs("admin");

    const session = await getSession();

    expect(session?.role).toBe("admin");
    expect(session?.impersonating).toBeNull();
    expect(h.decodePreviewCookie).not.toHaveBeenCalled();
  });
});

describe("getSession — no bearer token (web cookie path, unchanged)", () => {
  it("returns 401 (UNAUTHENTICATED) when there is no bearer token and no cookie session", async () => {
    h.getClaims.mockResolvedValue({ data: null, error: { message: "no session" } });

    await expect(requireSession()).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(h.getClaims).toHaveBeenCalledWith(undefined);
    expect(h.clientOptions[0]?.global.headers).toBeUndefined();
  });

  it("ignores a non-Bearer Authorization header and uses cookies", async () => {
    h.requestHeaders = new Headers({ authorization: "Basic dXNlcjpwYXNz" });
    h.requestCookies = [{ name: "sb-access-token", value: "cookie-token" }];
    h.getClaims.mockResolvedValue(claimsFor("site"));

    await getSession();

    expect(h.getClaims).toHaveBeenCalledWith(undefined);
    expect(h.clientOptions[0]?.global.headers).toBeUndefined();
    expect(h.clientOptions[0]?.cookies.getAll()).toEqual(h.requestCookies);
  });

  it("still applies an admin's preview cookie on the web", async () => {
    h.requestCookies = [{ name: "apex_preview", value: "signed-preview" }];
    h.getClaims.mockResolvedValue(claimsFor("admin"));
    profileAs("admin");

    const session = await getSession();

    expect(h.decodePreviewCookie).toHaveBeenCalledWith("signed-preview");
    expect(session?.impersonating).toEqual({ role: "site", projectId: PROJECT });
  });
});
