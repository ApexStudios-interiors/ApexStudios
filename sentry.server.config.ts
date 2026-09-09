import * as Sentry from "@sentry/nextjs";
import { redactEvent } from "@/lib/observability/redact";

/**
 * Server-side Sentry. Disabled in development (docs/build/01-foundations.md §3.13).
 *
 * The DSN is read from the environment rather than lib/env.ts because this file
 * is loaded by the Next.js instrumentation hook before the app boots, and an
 * unset DSN must degrade to "Sentry off", not to a crash.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN),

  // Tag every event with the deploy, so a regression points at a commit.
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

  tracesSampleRate: 0.1,

  // architecture.md §6.4: no monetary value and no personal name ever reaches
  // Sentry. The filter is tested in lib/observability/__tests__/redact.test.ts.
  beforeSend: (event) => redactEvent(event),
  beforeSendTransaction: (event) => redactEvent(event),
  beforeBreadcrumb: (breadcrumb) => {
    const [cleaned] = redactEvent({ breadcrumbs: [breadcrumb] }).breadcrumbs ?? [];
    return cleaned ?? breadcrumb;
  },

  // The default integration attaches request bodies, which on this application
  // means bill payloads. Off.
  sendDefaultPii: false,
});
