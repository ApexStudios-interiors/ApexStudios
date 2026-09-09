/**
 * Money and PII redaction for anything leaving the process.
 *
 * `docs/architecture.md` §6.4 classifies internal_amount, unit_cost, rate,
 * margin_amount and the bill internal block as Restricted: "Never in logs,
 * Sentry breadcrumbs, or analytics." §9.1 adds that scopes carry user.id and
 * role and nothing more.
 *
 * This is a data-classification control, not a nicety, which is why it is a
 * plain function with its own tests rather than an inline closure in the Sentry
 * config. If you need a money value to debug, reproduce locally against seed
 * data (§6.4).
 *
 * The pattern deliberately over-matches. A redacted "corporate_id" costs
 * nothing; a leaked margin is the one failure this product cannot absorb.
 */
export const RESTRICTED_KEY = /amount|rate|cost|margin|allocated|internal|price/i;

export const REDACTED = "[redacted]";

/** Depth cap: Sentry payloads are already normalised, and cycles must not hang. */
const MAX_DEPTH = 8;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = RESTRICTED_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Shape-tolerant: Sentry's Event and Breadcrumb types vary across versions. */
type Redactable = {
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  breadcrumbs?: { data?: Record<string, unknown>; message?: string }[];
  user?: Record<string, unknown>;
};

/**
 * Strips restricted keys from an event's extra, contexts, tags and breadcrumbs,
 * and reduces `user` to id and role. Returns a new object; the input is not
 * mutated.
 */
export function redactEvent<T extends Redactable>(event: T): T {
  const next: Redactable = { ...event };

  if (next.extra) next.extra = redactValue(next.extra) as Record<string, unknown>;
  if (next.contexts) next.contexts = redactValue(next.contexts) as Record<string, unknown>;
  if (next.tags) next.tags = redactValue(next.tags) as Record<string, unknown>;

  if (next.breadcrumbs) {
    next.breadcrumbs = next.breadcrumbs.map((b) =>
      b.data ? { ...b, data: redactValue(b.data) as Record<string, unknown> } : b
    );
  }

  // architecture.md §9.1: the scope carries user.id and role, nothing more.
  if (next.user) {
    const { id, role } = next.user;
    next.user = {
      ...(id === undefined ? {} : { id }),
      ...(role === undefined ? {} : { role }),
    };
  }

  return next as T;
}
