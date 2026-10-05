import "server-only";
import { NextResponse } from "next/server";
import { ForbiddenError, UnauthenticatedError, requireSession } from "@/lib/auth/session";
import { mapDomainError } from "@/lib/safe-action";
import { getNotifications } from "@/features/notifications/queries";

/**
 * GET /api/mobile/v1/notifications — the first mobile endpoint, and the proof
 * that a Bearer access token reaches RLS the same way a cookie does.
 *
 * Authenticates with `Authorization: Bearer <Supabase access token>`, read by
 * lib/supabase/server.ts and verified by getSession(). middleware.ts skips
 * /api/mobile/*, so this route is its own guard. The data comes from the same
 * getNotifications() the web bell uses, through the same RLS-scoped client.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET() {
  try {
    const session = await requireSession();
    const notifications = await getNotifications(session);
    return NextResponse.json({ notifications }, { headers: NO_STORE });
  } catch (e) {
    if (e instanceof UnauthenticatedError)
      return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401, headers: NO_STORE });
    if (e instanceof ForbiddenError)
      return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers: NO_STORE });
    // Same mapping as every Server Action: a raw Postgres message never leaves
    // the server; the log gets it, tagged with the reference the caller sees.
    const message = mapDomainError(e instanceof Error ? e : new Error(String(e)));
    return NextResponse.json({ error: "INTERNAL", message }, { status: 500, headers: NO_STORE });
  }
}
