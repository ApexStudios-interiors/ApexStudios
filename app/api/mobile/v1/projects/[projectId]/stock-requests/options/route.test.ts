import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required, admin/site only, project access
 * checked, then the web dialog's own helpers (getUnitOptions,
 * getProjectRateVisibility) — mocked here — returned as
 * `{ rateVisibility, units: [{ code, label }] }`, no-store, with errors
 * mapped like every other mobile route.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "mobile-token" as string | null,
    requireRole: vi.fn(),
    requireProjectAccess: vi.fn(),
    getUnitOptions: vi.fn(),
    getMaterialSuggestions: vi.fn(),
    getProjectRateVisibility: vi.fn(),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: h.UnauthenticatedError,
  ForbiddenError: h.ForbiddenError,
  requireRole: h.requireRole,
  requireProjectAccess: h.requireProjectAccess,
  requireSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  getBearerToken: async () => h.bearerToken,
  createClient: vi.fn(),
}));
vi.mock("@/features/stock/actions", () => ({
  getUnitOptions: h.getUnitOptions,
  getMaterialSuggestions: h.getMaterialSuggestions,
}));
vi.mock("@/features/projects/actions", () => ({ getProjectRateVisibility: h.getProjectRateVisibility }));

const { GET } = await import("./route");

const PROJECT_ID = "00000000-0000-4000-8000-0000000000c1";

function sessionAs(role: Session["role"]): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d1",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email: null,
    impersonating: null,
  };
}

const UNITS = [
  { code: "bag", label: "Bags" },
  { code: "sft", label: "Square feet" },
  { code: "nos", label: "Numbers" },
];

/** getMaterialSuggestions' own shape: distinct inventory item names. */
const MATERIALS = ["Cement OPC 53", "Pool-grade vitrified tile 300x300"];

function call(projectId = PROJECT_ID) {
  return GET(new Request(`http://localhost/api/mobile/v1/projects/${projectId}/stock-requests/options`), {
    params: Promise.resolve({ projectId }),
  });
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
  h.requireRole.mockReset();
  h.requireRole.mockResolvedValue(sessionAs("site"));
  h.requireProjectAccess.mockReset();
  h.requireProjectAccess.mockResolvedValue(undefined);
  h.getUnitOptions.mockReset();
  h.getUnitOptions.mockResolvedValue(UNITS);
  h.getMaterialSuggestions.mockReset();
  h.getMaterialSuggestions.mockResolvedValue(MATERIALS);
  h.getProjectRateVisibility.mockReset();
  h.getProjectRateVisibility.mockResolvedValue("readonly");
});

describe("GET /api/mobile/v1/projects/:projectId/stock-requests/options", () => {
  it.each(["admin", "site"] as const)(
    "returns the units and the project's rate visibility for %s (200, no-store)",
    async (role) => {
      const session = sessionAs(role);
      h.requireRole.mockResolvedValue(session);

      const res = await call();

      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ rateVisibility: "readonly", units: UNITS, materials: MATERIALS });
      expect(h.requireRole).toHaveBeenCalledExactlyOnceWith(["admin", "site"]);
      expect(h.requireProjectAccess).toHaveBeenCalledExactlyOnceWith(session, PROJECT_ID);
      expect(h.getProjectRateVisibility).toHaveBeenCalledExactlyOnceWith(PROJECT_ID);
      expect(h.getUnitOptions).toHaveBeenCalledOnce();
      expect(h.getMaterialSuggestions).toHaveBeenCalledOnce();
    }
  );

  it("returns the web dialog's own material suggestions, as the helper gives them", async () => {
    h.getMaterialSuggestions.mockResolvedValue(["Cement OPC 53", "River sand"]);

    const body = await (await call()).json();

    expect(body.materials).toEqual(["Cement OPC 53", "River sand"]);
  });

  it.each(["hidden", "readonly", "editable"] as const)(
    "returns rate visibility '%s' exactly as the project has it",
    async (visibility) => {
      h.getProjectRateVisibility.mockResolvedValue(visibility);

      const body = await (await call()).json();

      expect(body.rateVisibility).toBe(visibility);
    }
  );

  it("returns each unit as { code, label } only, in the helper's order", async () => {
    h.getUnitOptions.mockResolvedValue([
      { code: "bag", label: "Bags", sort_order: 1, internal: "x" },
      { code: "sft", label: "Square feet", sort_order: 2 },
    ]);

    const body = await (await call()).json();

    expect(body.units).toEqual([
      { code: "bag", label: "Bags" },
      { code: "sft", label: "Square feet" },
    ]);
    expect(Object.keys(body).sort()).toEqual(["materials", "rateVisibility", "units"]);
  });

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireRole).not.toHaveBeenCalled();
    expect(h.getUnitOptions).not.toHaveBeenCalled();
    expect(h.getMaterialSuggestions).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireRole.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call();

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.getUnitOptions).not.toHaveBeenCalled();
    expect(h.getMaterialSuggestions).not.toHaveBeenCalled();
  });

  it("returns 403 for a client, before any project or data read", async () => {
    h.requireRole.mockRejectedValue(new h.ForbiddenError("FORBIDDEN: requires one of: admin, site"));

    const res = await call();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getProjectRateVisibility).not.toHaveBeenCalled();
  });

  it("returns 404 for a project id that is not a uuid, before any project or data read", async () => {
    const res = await call("not-a-uuid");

    await expectError(res, 404, "NOT_FOUND", "That record no longer exists.");
    expect(h.requireProjectAccess).not.toHaveBeenCalled();
    expect(h.getUnitOptions).not.toHaveBeenCalled();
    expect(h.getMaterialSuggestions).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no access to the project", async () => {
    h.requireProjectAccess.mockRejectedValue(
      new h.ForbiddenError(`FORBIDDEN: not a member of project ${PROJECT_ID}`)
    );

    const res = await call();

    await expectError(res, 403, "FORBIDDEN", "You don't have permission to do that.");
    expect(h.getUnitOptions).not.toHaveBeenCalled();
    expect(h.getMaterialSuggestions).not.toHaveBeenCalled();
    expect(h.getProjectRateVisibility).not.toHaveBeenCalled();
  });

  it("returns 500 with a reference for an unexpected error, never the raw database message", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.getUnitOptions.mockRejectedValue(new Error('relation "units" does not exist'));

    const res = await call();

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
