import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { decodePreviewCookie, PREVIEW_COOKIE_NAME } from "@/lib/auth/impersonation";
import type { Role } from "@/lib/rbac/roles";
import { requiresMfa } from "@/lib/auth/mfa";

export type Session = {
  userId: string;
  orgId: string;
  role: Role;
  fullName: string;
  email: string | null;
  /** Authenticator Assurance Level. "aal2" means the user completed an MFA
   *  challenge this session. Used to require TOTP for owner/admin — see
   *  requireRole below — since Supabase has no per-role MFA project setting. */
  aal: "aal1" | "aal2";
  /** Set only for owner/admin previewing another role (D20). Reads are shaped
   *  by `impersonating.role`/`projectId`; writes always check the REAL role
   *  above, never this. */
  impersonating: { role: Role; projectId: string } | null;
};

export class UnauthenticatedError extends Error {
  constructor() {
    super("UNAUTHENTICATED");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(detail?: string) {
    super(detail ? `FORBIDDEN: ${detail}` : "FORBIDDEN");
    this.name = "ForbiddenError";
  }
}

/**
 * Wrapped in React's cache() so a layout and a page in the same render share
 * one lookup instead of issuing two round trips (architecture.md §7.4).
 *
 * Role and org come from the JWT claims the custom access token hook stamps
 * (02-lld.md §5.2) WHEN PRESENT, falling back to a profiles read only when
 * they are absent — the same coalesce order auth_role()/auth_org() use inside
 * Postgres (migration 0002). This is not an optimisation detail: RLS enforces
 * against the JWT claim, so if this function preferred a fresher table read
 * over a present claim, the UI could show capabilities RLS would then refuse,
 * which is a worse failure than both layers being consistently stale for up to
 * 30 minutes. setUserRole/deactivateUser force a global sign-out specifically
 * because that is the only way to invalidate the stale claim in either layer.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();

  // getClaims() verifies the JWT (locally via the project's signing key, or
  // against the Auth server if using a symmetric secret) and returns its
  // decoded payload, including whatever the hook stamped into app_metadata —
  // getUser() would not: it returns the CURRENT auth.users row, which never
  // receives the hook's transient, token-scoped claims.
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError || !claimsData) return null;

  const claims = claimsData.claims;
  const userId = claims.sub;
  if (!userId) return null;

  const claimRole = (claims.app_metadata as Record<string, unknown> | undefined)?.app_role as
    Role | undefined;
  const claimOrgId = (claims.app_metadata as Record<string, unknown> | undefined)?.org_id as
    string | undefined;

  if (!claimRole || !claimOrgId) {
    // build/03-auth-and-rbac.md §2.1: a misregistered hook is otherwise
    // invisible. This is the one place that would notice.
    console.warn(
      `[auth] app_metadata.app_role/org_id absent from JWT for user ${userId}. ` +
        "The custom_access_token_hook may not be registered for this environment " +
        "(supabase/config.toml [auth.hook.custom_access_token], or the dashboard " +
        "equivalent). Falling back to a profiles read; this is slower, not insecure."
    );
  }

  // full_name and is_active have no JWT claim (the hook does not stamp them,
  // and should not — they are not authorization-relevant). One query either
  // supplies those, or — when the claim was absent above — doubles as the
  // fallback source for role/org_id too, so this is always exactly one query.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("org_id, role, full_name, email, is_active")
    .eq("id", userId)
    .single();

  if (profileError || !profile || !profile.is_active) return null;

  const role = claimRole ?? profile.role;
  const orgId = claimOrgId ?? profile.org_id;
  const aal = (claims.aal === "aal2" ? "aal2" : "aal1") as "aal1" | "aal2";

  let impersonating: Session["impersonating"] = null;
  if (role === "owner" || role === "admin") {
    const cookieStore = await cookies();
    const preview = decodePreviewCookie(cookieStore.get(PREVIEW_COOKIE_NAME)?.value);
    if (preview) impersonating = { role: preview.role, projectId: preview.projectId };
  }

  return {
    userId,
    orgId,
    role,
    fullName: profile.full_name,
    email: profile.email ?? claims.email ?? null,
    aal,
    impersonating,
  };
});

/** Throws UNAUTHENTICATED rather than returning null — the default for most
 *  call sites, which want to stop rather than branch on a missing session. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

/**
 * architecture.md T12: MFA required for owner/admin. Supabase has no per-role
 * project setting for this — it is enforced here, against the session's own
 * AAL, because that is the only place "this specific role" and "was MFA
 * actually completed this session" are both known at once.
 */
function requireAalForRole(session: Session): void {
  if (requiresMfa(session.role) && session.aal !== "aal2") {
    throw new ForbiddenError("MFA required for this role");
  }
}

/**
 * Checks the REAL role, never the impersonated one — impersonation only ever
 * shapes reads (see getSession's doc comment and lib/safe-action.ts), so a
 * guard deciding whether an action may run must not be fooled by it.
 */
export async function requireRole(roles: Role[]): Promise<Session> {
  const session = await requireSession();
  requireAalForRole(session);
  if (!roles.includes(session.role)) throw new ForbiddenError(`requires one of: ${roles.join(", ")}`);
  return session;
}

/**
 * Asks the DATABASE, not a cached list. owner/admin pass implicitly
 * (02-lld.md §3.2 — they are not required to have project_members rows);
 * site/client require an actual row. RLS would catch a mistake here too, but
 * a clean 403 is a better experience than a page that silently renders empty.
 *
 * Reads through the RLS-scoped client, so this can never return true for a
 * project outside the session's own org — is_member_of() checks org
 * implicitly via RLS on project_members itself.
 */
export async function requireProjectAccess(session: Session, projectId: string): Promise<void> {
  if (session.role === "owner" || session.role === "admin") return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("profile_id", session.userId)
    .maybeSingle();

  if (error || !data) throw new ForbiddenError(`not a member of project ${projectId}`);
}
