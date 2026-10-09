/**
 * The two request headers middleware uses to hand the slugs it resolved to
 * the page it rewrote to.
 *
 * Their own module because middleware runs on the edge and cannot import
 * `lib/routing/current.ts`, which is marked `server-only`. Names in one place
 * so the writer and the reader cannot disagree.
 */
export const PROJECT_SLUG_HEADER = "x-apex-project-slug";
export const PACKAGE_SLUG_HEADER = "x-apex-package-slug";
