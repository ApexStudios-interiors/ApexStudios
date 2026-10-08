import "server-only";
import { NextResponse } from "next/server";
import { NO_STORE, mobileErrorFrom, requireBearerSession } from "@/lib/mobile/api";
import { getNotifications } from "@/features/notifications/queries";

/**
 * GET /api/mobile/v1/notifications — the first mobile endpoint, and the proof
 * that a Bearer access token reaches RLS the same way a cookie does.
 *
 * Authenticates with `Authorization: Bearer <Supabase access token>`, read by
 * lib/supabase/server.ts and verified by getSession(). middleware.ts skips
 * /api/mobile/*, so this route is its own guard. The data comes from the same
 * getNotifications() the web bell uses, through the same RLS-scoped client.
 *
 * Bearer only (lib/mobile/api.ts requireBearerSession): a request without an
 * `Authorization: Bearer` header is refused before anything else, so a
 * browser's session cookie can never authorize it. Errors are
 * `{ error, message }`, as on every other mobile route.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await requireBearerSession();
    const notifications = await getNotifications(session);
    return NextResponse.json({ notifications }, { headers: NO_STORE });
  } catch (e) {
    // { error, message } with mapDomainError's copy (lib/mobile/api.ts): a raw
    // Postgres message never leaves the server; the log gets it, tagged with
    // the reference the caller sees.
    return mobileErrorFrom(e);
  }
}
