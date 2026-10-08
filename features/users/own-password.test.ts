import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * bearerPasswordSteps — how the mobile app's password change reaches GoTrue,
 * with @supabase/ssr and fetch faked. What it pins down: the current password
 * is checked by a real sign-in with the given email on a throwaway client
 * (persisting nothing, carrying no user token), whose probe session is then
 * signed out; the new password is set as the CALLER's own session (the bearer
 * token) with the anon key only; and a failure never carries a password.
 */

const h = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://apex.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
  },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: h.createServerClient }));

const { bearerPasswordSteps } = await import("./own-password");

const TOKEN = "phone-access-token";
const fetchMock = vi.fn();

beforeEach(() => {
  h.signInWithPassword.mockReset();
  h.signInWithPassword.mockResolvedValue({ error: null });
  h.signOut.mockReset();
  h.signOut.mockResolvedValue({ error: null });
  h.createServerClient.mockReset();
  h.createServerClient.mockReturnValue({
    auth: { signInWithPassword: h.signInWithPassword, signOut: h.signOut },
  });
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bearerPasswordSteps — verifyCurrentPassword", () => {
  it("re-authenticates with the session's email and the typed password, then ends the probe session", async () => {
    const ok = await bearerPasswordSteps(TOKEN).verifyCurrentPassword("ravi@beapex.in", "current-password-1");

    expect(ok).toBe(true);
    expect(h.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
      email: "ravi@beapex.in",
      password: "current-password-1",
    });
    expect(h.signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
  });

  it("uses a throwaway client: anon key, nothing persisted, and NOT the caller's token", async () => {
    await bearerPasswordSteps(TOKEN).verifyCurrentPassword("ravi@beapex.in", "current-password-1");

    const [url, key, options] = h.createServerClient.mock.calls[0] ?? [];
    expect(url).toBe("https://apex.supabase.co");
    expect(key).toBe("anon-key");
    expect(options.auth).toMatchObject({ persistSession: false, autoRefreshToken: false });
    expect(options.global?.headers?.Authorization).toBeUndefined();
    expect(options.cookies.getAll()).toEqual([]);
  });

  it("returns false — and signs nothing out — when GoTrue refuses the password", async () => {
    h.signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });

    const ok = await bearerPasswordSteps(TOKEN).verifyCurrentPassword("ravi@beapex.in", "wrong-password");

    expect(ok).toBe(false);
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("still succeeds if ending the probe session fails", async () => {
    h.signOut.mockRejectedValue(new Error("network"));

    await expect(bearerPasswordSteps(TOKEN).verifyCurrentPassword("ravi@beapex.in", "current")).resolves.toBe(
      true
    );
  });
});

describe("bearerPasswordSteps — setOwnPassword", () => {
  it("PUTs the new password to GoTrue as the caller's own session, with the anon key only", async () => {
    await bearerPasswordSteps(TOKEN).setOwnPassword("a-much-longer-new-one");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://apex.supabase.co/auth/v1/user");
    expect(init.method).toBe("PUT");
    expect(init.headers).toEqual({
      apikey: "anon-key",
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(init.body)).toEqual({ password: "a-much-longer-new-one" });
  });

  it("throws GoTrue's error code — never the password — when the change is refused", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error_code: "weak_password", msg: "Password is too weak" }), {
        status: 422,
      })
    );

    const attempt = bearerPasswordSteps(TOKEN).setOwnPassword("a-much-longer-new-one");

    await expect(attempt).rejects.toThrow("updateOwnPassword: weak_password");
    await expect(bearerPasswordSteps(TOKEN).setOwnPassword("a-much-longer-new-one")).rejects.not.toThrow(
      /a-much-longer-new-one/
    );
  });

  it("throws the HTTP status when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }));

    await expect(bearerPasswordSteps(TOKEN).setOwnPassword("a-much-longer-new-one")).rejects.toThrow(
      "updateOwnPassword: 502"
    );
  });
});
