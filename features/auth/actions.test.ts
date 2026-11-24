import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * APX-38: the per-username sign-in throttle, as signInWithPassword uses it.
 * The rule itself (10 failures / 15 minutes) is the database's — pinned in
 * supabase/tests/15_security_hardening_test.sql. This pins the action's half:
 * ask first, never reach GoTrue for a locked username, record a failure (and
 * only a failure), and fail open if the throttle itself is unavailable.
 */

type RpcResult = { data: unknown; error: { message: string } | null };

const h = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: unknown) => Promise<RpcResult>>(),
  signIn: vi.fn<(args: unknown) => Promise<{ error: { message: string } | null }>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  UnauthenticatedError: class extends Error {},
  ForbiddenError: class extends Error {},
  requireSession: vi.fn(),
  requireRole: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: h.rpc, auth: { signInWithPassword: h.signIn } }),
}));

const { signInWithPassword } = await import("./actions");
const { LOGIN_LOCKED_MESSAGE } = await import("./login-throttle");

function throttle(allowed: RpcResult) {
  h.rpc.mockImplementation(async (name) =>
    name === "rpc_login_allowed" ? allowed : { data: null, error: null }
  );
}

beforeEach(() => {
  h.rpc.mockReset();
  h.signIn.mockReset();
  throttle({ data: true, error: null });
  h.signIn.mockResolvedValue({ error: null });
});

describe("signInWithPassword — per-username throttle (APX-38)", () => {
  it("asks the throttle with the username only, then signs in", async () => {
    const result = await signInWithPassword({ username: "ravi", password: "secret-pass" });

    expect(result.data).toEqual({ ok: true });
    expect(h.rpc).toHaveBeenCalledWith("rpc_login_allowed", { p_username: "ravi" });
    expect(h.rpc).not.toHaveBeenCalledWith("rpc_login_record_failure", expect.anything());
  });

  it("never reaches GoTrue for a locked username", async () => {
    throttle({ data: false, error: null });

    const result = await signInWithPassword({ username: "ravi", password: "secret-pass" });

    expect(result.data).toEqual({ ok: false, message: LOGIN_LOCKED_MESSAGE });
    expect(h.signIn).not.toHaveBeenCalled();
  });

  it("records a failed sign-in against the username, with the usual message", async () => {
    h.signIn.mockResolvedValue({ error: { message: "Invalid login credentials" } });

    const result = await signInWithPassword({ username: "ravi", password: "wrong" });

    expect(result.data).toEqual({ ok: false, message: "Incorrect username or password." });
    expect(h.rpc).toHaveBeenCalledWith("rpc_login_record_failure", { p_username: "ravi" });
  });

  it("fails open when the throttle cannot be read — it must never lock everyone out", async () => {
    throttle({ data: null, error: { message: "function does not exist" } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await signInWithPassword({ username: "ravi", password: "secret-pass" });

    expect(result.data).toEqual({ ok: true });
    expect(h.signIn).toHaveBeenCalledOnce();
    quiet.mockRestore();
  });
});
