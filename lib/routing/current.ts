import "server-only";
import { headers } from "next/headers";
import { PACKAGE_SLUG_HEADER, PROJECT_SLUG_HEADER } from "./headers";

/**
 * The canonical base path for the project (and package) in the current URL.
 *
 * Needed because middleware REWRITES a readable URL to the id form, so a page
 * receives the UUID in `params` and cannot build a readable link from it. A
 * link built from that UUID still works — middleware redirects it — but the
 * redirect is a whole second request, `getUser()` and all, and it also
 * defeats Next's prefetch, so the link is never warmed either.
 *
 * Middleware therefore puts the slugs it already resolved on the request, and
 * these read them back. No extra query: the work was done to route the
 * request at all.
 */

export { PACKAGE_SLUG_HEADER, PROJECT_SLUG_HEADER } from "./headers";

/**
 * `/projects/bhel-nch`, or the id form when the header is absent.
 *
 * Absent is a real case, not a defensive flourish: a request that arrived on
 * the id form is redirected rather than rewritten, so nothing sets the header
 * on that first pass. Falling back keeps the link correct — it just costs the
 * redirect this exists to avoid, which is what that request was already doing.
 */
export async function projectBase(projectId: string): Promise<string> {
  const slug = (await headers()).get(PROJECT_SLUG_HEADER);
  return `/projects/${slug || projectId}`;
}

/** `/projects/bhel-nch/packages/facade-and-windows`, same fallback. */
export async function packageBase(projectId: string, packageId: string): Promise<string> {
  const h = await headers();
  const project = h.get(PROJECT_SLUG_HEADER) || projectId;
  const pkg = h.get(PACKAGE_SLUG_HEADER) || packageId;
  return `/projects/${project}/packages/${pkg}`;
}
