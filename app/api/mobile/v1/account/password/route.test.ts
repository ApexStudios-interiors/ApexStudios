import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * The route's own contract: Bearer required (a cookie session alone never
 * authorizes it), any signed-in role, only the three passwords read from the
 * body and validated by the web's own changeMyPasswordSchema (real), the
 * web's own changeMyPassword service (real) run with the bearer steps for the
 * caller's token and the SESSION's email, refusals as 422 with the web's
 * copy (never 401), `{ ok: true }` on success, no-store, and no password in
 * any response. The steps themselves are mocked — they are tested in
 * features/users/own-password.test.ts.
 */

const h = vi.hoisted(() => {
  class UnauthenticatedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    UnauthenticatedError,
    ForbiddenError,
    bearerToken: "phone-access-token" as string | null,
    requireSession: vi.fn(),
    bearerPasswordSteps: vi.fn(),
    verifyCurrentPassword: vi.fn(),
    setOwnPassword: vi.fn(),
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
vi.mock("@/features/users/own-password", () => ({ bearerPasswordSteps: h.bearerPasswordSteps }));

const { POST } = await import("./route");

const CURRENT = "current-password-1";
const NEXT = "a-much-longer-new-one";
const BODY = { currentPassword: CURRENT, newPassword: NEXT, confirmPassword: NEXT };

function sessionAs(role: Session["role"], email: string | null = "ravi@beapex.in"): Session {
  return {
    userId: "00000000-0000-4000-8000-0000000000d5",
    orgId: "00000000-0000-4000-8000-0000000000a0",
    role,
    fullName: "Test User",
    email,
    impersonating: null,
  };
}

function call(body: unknown, raw?: string) {
  return POST(
    new Request("http://localhost/api/mobile/v1/account/password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ?? JSON.stringify(body),
    })
  );
}

/** Every response body, as text — to prove no password ever appears in one. */
async function expectNoPasswordIn(res: Response) {
  const text = await res.clone().text();
  expect(text).not.toContain(CURRENT);
  expect(text).not.toContain(NEXT);
}

async function expectError(res: Response, status: number, error: string, message: string | RegExp) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  await expectNoPasswordIn(res);
  const body = await res.json();
  expect(body.error).toBe(error);
  if (typeof message === "string") expect(body.message).toBe(message);
  else expect(body.message).toMatch(message);
  expect(Object.keys(body).sort()).toEqual(["error", "message"]);
}

beforeEach(() => {
  h.bearerToken = "phone-access-token";
  h.requireSession.mockReset();
  h.requireSession.mockResolvedValue(sessionAs("site"));
  h.verifyCurrentPassword.mockReset();
  h.verifyCurrentPassword.mockImplementation(
    async (_email: string, password: string) => password === CURRENT
  );
  h.setOwnPassword.mockReset();
  h.setOwnPassword.mockResolvedValue(undefined);
  h.bearerPasswordSteps.mockReset();
  h.bearerPasswordSteps.mockReturnValue({
    verifyCurrentPassword: h.verifyCurrentPassword,
    setOwnPassword: h.setOwnPassword,
  });
});

describe("POST /api/mobile/v1/account/password", () => {
  it("changes the password and returns exactly { ok: true } (200, no-store)", async () => {
    const res = await call(BODY);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expectNoPasswordIn(res);
    expect(await res.json()).toEqual({ ok: true });
  });

  it.each(["admin", "site", "client"] as const)("lets %s change its own password", async (role) => {
    h.requireSession.mockResolvedValue(sessionAs(role));

    const res = await call(BODY);

    expect(res.status).toBe(200);
    expect(h.setOwnPassword).toHaveBeenCalledExactlyOnceWith(NEXT);
  });

  it("verifies the current password first — the session's email and the typed password — then sets the new one", async () => {
    await call(BODY);

    expect(h.bearerPasswordSteps).toHaveBeenCalledExactlyOnceWith("phone-access-token");
    expect(h.verifyCurrentPassword).toHaveBeenCalledExactlyOnceWith("ravi@beapex.in", CURRENT);
    expect(h.setOwnPassword).toHaveBeenCalledExactlyOnceWith(NEXT);
    expect(h.verifyCurrentPassword.mock.invocationCallOrder[0]).toBeLessThan(
      h.setOwnPassword.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("never lets the request name another user — the session's email and token are the only ones used", async () => {
    await call({ ...BODY, userId: "00000000-0000-4000-8000-0000000000d2", email: "suresh@beapex.in" });

    expect(h.verifyCurrentPassword).toHaveBeenCalledExactlyOnceWith("ravi@beapex.in", CURRENT);
    expect(h.bearerPasswordSteps).toHaveBeenCalledExactlyOnceWith("phone-access-token");
  });

  it("trims all three, as the web schema does", async () => {
    await call({ currentPassword: `  ${CURRENT} `, newPassword: ` ${NEXT}  `, confirmPassword: `${NEXT} ` });

    expect(h.verifyCurrentPassword).toHaveBeenCalledExactlyOnceWith("ravi@beapex.in", CURRENT);
    expect(h.setOwnPassword).toHaveBeenCalledExactlyOnceWith(NEXT);
  });

  it("refuses a wrong current password with 422 and the web's copy — never 401 — changing nothing", async () => {
    const res = await call({ ...BODY, currentPassword: "not-my-password" });

    await expectError(res, 422, "WRONG_PASSWORD", "That isn't your current password");
    expect(h.setOwnPassword).not.toHaveBeenCalled();
  });

  it("refuses an account with no username to re-authenticate as (422)", async () => {
    h.requireSession.mockResolvedValue(sessionAs("client", null));

    const res = await call(BODY);

    await expectError(
      res,
      422,
      "NO_EMAIL",
      "This account has no username to sign in with. Ask an admin for help."
    );
    expect(h.verifyCurrentPassword).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a new password under 12 characters",
      { ...BODY, newPassword: "short-one", confirmPassword: "short-one" },
      "At least 12 characters",
    ],
    [
      "12 characters made of whitespace",
      { ...BODY, newPassword: "     a      ", confirmPassword: "     a      " },
      "At least 12 characters",
    ],
    [
      "a new password over 72 bytes",
      { ...BODY, newPassword: "é".repeat(37), confirmPassword: "é".repeat(37) },
      "At most 72 bytes",
    ],
    [
      "a confirmation that does not match",
      { ...BODY, confirmPassword: `${NEXT}x` },
      "The two passwords don't match",
    ],
    [
      "a new password equal to the current one",
      { currentPassword: NEXT, newPassword: NEXT, confirmPassword: NEXT },
      "Choose a password different from your current one",
    ],
    ["a missing current password", { newPassword: NEXT, confirmPassword: NEXT }, /./],
    ["a blank current password", { ...BODY, currentPassword: "   " }, "Enter your current password"],
    ["a missing confirmation", { currentPassword: CURRENT, newPassword: NEXT }, /./],
    ["a password that is not text", { ...BODY, newPassword: 123456789012 }, /./],
  ])(
    "returns 400 for %s, with the web schema's own message, changing nothing",
    async (_label, body, message) => {
      const res = await call(body);

      await expectError(res, 400, "VALIDATION", message);
      expect(h.verifyCurrentPassword).not.toHaveBeenCalled();
      expect(h.setOwnPassword).not.toHaveBeenCalled();
    }
  );

  it("returns 401 with no Bearer header — a cookie session alone is never enough", async () => {
    h.bearerToken = null;

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.requireSession).not.toHaveBeenCalled();
    expect(h.bearerPasswordSteps).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid or expired Bearer token", async () => {
    h.requireSession.mockRejectedValue(new h.UnauthenticatedError("UNAUTHENTICATED"));

    const res = await call(BODY);

    await expectError(res, 401, "UNAUTHENTICATED", "Your session expired. Please sign in again.");
    expect(h.setOwnPassword).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call(undefined, "currentPassword=x");

    await expectError(res, 400, "VALIDATION", "Request body must be valid JSON.");
  });

  it("returns 400 for a body that is not an object", async () => {
    const res = await call([CURRENT, NEXT]);

    await expectError(res, 400, "VALIDATION", "Request body must be a JSON object.");
  });

  it("returns 500 with a reference when GoTrue refuses the change — no password in it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    h.setOwnPassword.mockRejectedValue(new Error("updateOwnPassword: weak_password"));

    const res = await call(BODY);

    await expectError(res, 500, "INTERNAL", /^Something went wrong\. Reference: [0-9a-f-]{36}$/);
    for (const args of consoleError.mock.calls) {
      expect(JSON.stringify(args.map(String))).not.toContain(NEXT);
      expect(JSON.stringify(args.map(String))).not.toContain(CURRENT);
    }
    consoleError.mockRestore();
  });
});
