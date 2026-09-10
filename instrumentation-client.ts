import * as Sentry from "@sentry/nextjs";
import { redactEvent } from "@/lib/observability/redact";

/**
 * Browser Sentry. The DSN is public by design; the anon key next to it is too.
 * What must never reach here is a money value — hence the same filter as the
 * server, applied before anything leaves the page.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend: (event) => redactEvent(event),
  sendDefaultPii: false,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
