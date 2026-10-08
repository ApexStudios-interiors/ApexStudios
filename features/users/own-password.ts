import "server-only";
import { createServerClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env.client";
import type { ChangeMyPasswordSteps } from "./service";

/**
 * The two steps of a self-service password change (service.ts
 * `changeMyPassword`) for a caller authenticated by an `Authorization: Bearer`
 * access token — the mobile app. The web action (actions.ts
 * changeMyPasswordAction) supplies the same two steps for a cookie session;
 * only how each reaches GoTrue differs, because the two sessions live in
 * different places:
 *
 * VERIFY — exactly the web's check: a real re-authentication,
 * `signInWithPassword` with the session's own email and the typed current
 * password (GoTrue has no "check this password" endpoint and
 * `secure_password_change` is off). On the web, the fresh session it issues
 * replaces the browser's cookies. The phone keeps its own session in
 * SecureStore and nothing here can (or should) write to it, so the sign-in
 * runs on a throwaway client that persists nothing, and the probe session it
 * created is signed out again at once.
 *
 * SET — the web's `updateUser({ password })` as the CALLER's session: GoTrue's
 * PUT /auth/v1/user (the request updateUser itself makes) with the phone's
 * own access token. GoTrue then logs out every session of this user except
 * the one that made the request (models.LogoutAllExceptMe) — so, exactly as
 * on the web, the phone stays signed in and every other device is signed out.
 * Running updateUser on the bearer client after the probe sign-in would have
 * acted as the probe's session instead and silently signed the PHONE out.
 *
 * Only the anon key and the user's own token: no service_role, no admin API,
 * so this can only ever act on the signed-in user's own account. Neither
 * password is logged, returned, or placed in an error — a failure carries
 * GoTrue's error code or HTTP status only.
 */
export function bearerPasswordSteps(accessToken: string): ChangeMyPasswordSteps {
  const url = clientEnv.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    verifyCurrentPassword: async (email, password) => {
      const probe = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return [];
          },
          setAll() {},
        },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
      });
      const { error } = await probe.auth.signInWithPassword({ email, password });
      if (error) return false;
      // The probe's own session is not needed: end it rather than leave it.
      // Best effort — the password change below logs it out regardless.
      await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
      return true;
    },

    setOwnPassword: async (password) => {
      const response = await fetch(`${url}/auth/v1/user`, {
        method: "PUT",
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
      if (response.ok) return;
      // GoTrue's code, never the input — the input is the password.
      let code: unknown = null;
      try {
        const body = (await response.json()) as { error_code?: unknown; code?: unknown };
        code = body.error_code ?? body.code ?? null;
      } catch {
        // A non-JSON body: the status is enough.
      }
      throw new Error(`updateOwnPassword: ${typeof code === "string" ? code : response.status}`);
    },
  };
}
