import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the production build on a type error rather than shipping it.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Enables forbidden() / app/forbidden.tsx (build/03-auth-and-rbac.md §2.11).
    // Off by default in Next 16; without this the call throws but there is no
    // matching special file to catch it, and it falls through to error.tsx.
    authInterrupts: true,
  },
};

/**
 * Source maps are uploaded at build and the release is tagged with the git SHA,
 * so a regression is traceable to a deploy (docs/architecture.md §9.1).
 *
 * Without SENTRY_AUTH_TOKEN the wrapper is inert: it still builds, it just
 * uploads nothing. That is the state until the Sentry organisation exists.
 */
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Do not serve source maps publicly — they would hand out the whole codebase.
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
});
