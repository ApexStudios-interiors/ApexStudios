import * as Sentry from "@sentry/nextjs";
import { redactEvent } from "@/lib/observability/redact";

// Middleware runs on the edge runtime and needs its own init. Same rules.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: process.env.NODE_ENV === "production" && Boolean(process.env.SENTRY_DSN),
  release: process.env.VERCEL_GIT_COMMIT_SHA,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend: (event) => redactEvent(event),
  sendDefaultPii: false,
});
