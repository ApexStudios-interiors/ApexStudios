/**
 * build/06-files-jobs-daily-updates.md §4.1. Pure — no `next/*`, no
 * `server-only` (code-standards §1, AGENTS.md's own layering rule).
 *
 * Mirrors `daily_updates`' own `du_update_author` RLS policy
 * (`created_at > now() - interval '24 hours'`, 02-lld.md §3.7) so the UI can
 * hide an Edit control before the server has to say no — the RLS predicate
 * is still the real enforcement; this is a friendlier failure, not a second
 * copy of the security boundary.
 */
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canEditUpdate(
  update: { authorId: string; createdAt: string },
  userId: string,
  now: Date
): boolean {
  if (update.authorId !== userId) return false;
  return now.getTime() - new Date(update.createdAt).getTime() < EDIT_WINDOW_MS;
}
