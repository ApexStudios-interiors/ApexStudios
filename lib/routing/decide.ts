import { isUuid } from "./slug";

/**
 * What middleware will do with a given pathname, decided without touching the
 * database — so the cost of a link can be asserted in a test rather than
 * argued about.
 *
 *   pass      not a project path; middleware adds nothing
 *   rewrite   readable URL; resolved to ids internally, one request
 *   redirect  contains an id; answered with a 307 to the readable form, so
 *             the browser makes a SECOND request — a second `getUser()` round
 *             trip to Supabase Auth, and a second pass through everything
 *             below it, before the page starts
 *
 * `lookups` is how many database reads the resolution itself costs, on top of
 * the `getUser()` every request already pays.
 */
export type RouteDecision = {
  action: "pass" | "rewrite" | "redirect";
  lookups: number;
};

/**
 * Exported so middleware matches on the SAME pattern these tests assert
 * against — a second copy there could drift and the measurement would quietly
 * stop describing the real thing.
 */
export const PROJECT_PATH_RE = /^\/projects\/([^/]+)(?:\/packages\/([^/]+))?(\/.*)?$/;

export function decideRoute(pathname: string): RouteDecision {
  const m = PROJECT_PATH_RE.exec(pathname);
  if (!m) return { action: "pass", lookups: 0 };
  const [, projectSeg, packageSeg] = m;
  if (!projectSeg) return { action: "pass", lookups: 0 };

  const projectIsId = isUuid(projectSeg);
  const packageIsId = packageSeg ? isUuid(packageSeg) : false;

  if (!projectIsId && !(packageSeg && packageIsId)) {
    return { action: "rewrite", lookups: packageSeg ? 2 : 1 };
  }
  return { action: "redirect", lookups: packageSeg ? 2 : 1 };
}

/**
 * Total requests a navigation to this path costs, counting the redirect's
 * second trip. A canonical link is 1; an id link is 2.
 */
export function requestsFor(pathname: string): number {
  return decideRoute(pathname).action === "redirect" ? 2 : 1;
}
