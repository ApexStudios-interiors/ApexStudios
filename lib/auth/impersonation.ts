import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { Role } from "@/lib/rbac/roles";

/**
 * The signed cookie behind "preview as" (D20, build/03-auth-and-rbac.md §2.9).
 *
 * Deliberately NOT a JWT or a session-store row: the whole cookie is one
 * self-contained, HMAC-signed value, 15-minute lifetime, read by getSession()
 * on every request. If it fails to verify for any reason — wrong signature,
 * expired, malformed — the caller gets `null`, i.e. "not impersonating".
 * Fail closed, never fail open.
 *
 * This cookie only ever WIDENS what getSession() reports for read-shaping; it
 * never substitutes for the real session and never appears anywhere writes are
 * authorised. See lib/auth/session.ts for how the two stay separate.
 */
const COOKIE_NAME = "apex_preview";
const TTL_MS = 15 * 60 * 1000;

/**
 * The roles a preview may be started as. `owner` is deliberately absent — a
 * preview only ever narrows, and there is nothing above the owner to preview.
 * `admin` is owner-only, which is a property of the CALLER, not of the cookie:
 * it is enforced in features/auth/impersonation-actions.ts (the real session
 * role, before the cookie is minted) and again in lib/auth/session.ts (which
 * ignores an admin preview held by anyone but the owner).
 */
export const PREVIEW_ROLES = ["client", "site", "admin"] as const;
export type PreviewRole = (typeof PREVIEW_ROLES)[number];

function isPreviewRole(role: unknown): role is PreviewRole {
  return (PREVIEW_ROLES as readonly unknown[]).includes(role);
}

export type ImpersonationPayload = { role: Role; projectId: string; issuedAt: number };

function sign(payload: string): string {
  return createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
}

export function encodePreviewCookie(
  role: PreviewRole,
  projectId: string
): { name: string; value: string; maxAge: number } {
  const payload: ImpersonationPayload = { role, projectId, issuedAt: Date.now() };
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  const signature = sign(encoded);
  return { name: COOKIE_NAME, value: `${encoded}.${signature}`, maxAge: TTL_MS / 1000 };
}

export function decodePreviewCookie(raw: string | undefined): ImpersonationPayload | null {
  if (!raw) return null;
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) return null;

  const expected = sign(encoded);
  // Constant-time comparison. A cookie value is attacker-controlled input; a
  // string === here would leak timing information about how much of the
  // signature matched, byte by byte.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: ImpersonationPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (Date.now() - payload.issuedAt > TTL_MS) return null;
  if (!isPreviewRole(payload.role)) return null;
  if (typeof payload.projectId !== "string" || !payload.projectId) return null;
  return payload;
}

export const PREVIEW_COOKIE_NAME = COOKIE_NAME;
