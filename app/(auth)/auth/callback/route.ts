import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EmailOtpType } from "@supabase/supabase-js";

/**
 * Exchanges a magic link for a session, then redirects.
 * build/03-auth-and-rbac.md §2.7: admin/owner/site and client both land on
 * "/" — the portfolio page already role-shapes itself, so there is no
 * per-role branch to get wrong here.
 *
 * Handles two verification shapes, both server-side, both PKCE-adjacent (no
 * tokens ever pass through a URL fragment, which the server cannot see at
 * all — fragments never leave the browser):
 *
 *  - `?code=` — what requestMagicLink's own signInWithOtp call produces via
 *    the browser client's default flow. The one real end users hit.
 *  - `?token_hash=&type=` — Supabase's other supported verification shape
 *    (`auth.verifyOtp`). Exercised by e2e/global-setup.ts, which authenticates
 *    the client role via the Admin API's `generateLink` — there is no
 *    end-user browser to hold a PKCE code_verifier for an admin-issued link,
 *    so this is the only shape an admin-generated link can produce. Handling
 *    it here is not a test-only shim: it is the documented alternative to the
 *    `?code=` flow, and accepting both makes this route robust to how a
 *    customised email template (build/03-auth-and-rbac.md §0.1, not yet done)
 *    ends up linking here.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/auth/error", request.url));
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return NextResponse.redirect(new URL("/auth/error", request.url));
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.redirect(new URL("/auth/error", request.url));
}
