import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { drain, reap, selfEnqueueAndDrain, type DrainSummary } from "@/lib/jobs/runner";
import { DRAIN_JOB_NAMES } from "@/lib/jobs/registry";

/**
 * build/06-files-jobs-daily-updates.md §3.2. One dynamic route serves every
 * cron entry in vercel.json — the [job] segment IS the cron identity, not a
 * job name from `jobs.name` (jobs.drain claims several of those; jobs.reap
 * claims none at all). "Do no real work in the route handler" (AGENTS.md
 * background job rule 3): everything here is claim/dispatch/record, deferred
 * to lib/jobs/runner.ts.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KNOWN_JOBS = [
  "jobs.drain",
  "jobs.reap",
  "inventory.reconcile",
  "weekly.maintenance",
  "backup.verify",
] as const;
type KnownJob = (typeof KNOWN_JOBS)[number];

function isKnownJob(job: string): job is KnownJob {
  return (KNOWN_JOBS as readonly string[]).includes(job);
}

/** Idempotency-key granularity for a self-enqueued scheduled job — a date
 *  for a daily one, so a retried tick within the same day is a no-op. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO 8601 week ("2026-W37") for weekly.maintenance's two tasks — a retried
 *  or overlapping tick within the same week is a no-op, same reasoning. */
function isoWeekKey(): string {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ job: string }> }) {
  // 1. Bearer auth — 401 before anything else, including the job name.
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. An unknown job name is a 404, not a 500.
  const { job } = await params;
  if (!isKnownJob(job)) {
    return NextResponse.json({ error: "unknown job" }, { status: 404 });
  }

  // 3. Claim a bounded batch, dispatch, finish — never real work here.
  let summary: DrainSummary | { requeued: number };
  switch (job) {
    case "jobs.drain":
      summary = await drain(DRAIN_JOB_NAMES);
      break;
    case "jobs.reap":
      summary = await reap();
      break;
    case "inventory.reconcile":
      summary = await selfEnqueueAndDrain("inventory.reconcile", {}, todayKey());
      break;
    case "weekly.maintenance": {
      const sweep = await selfEnqueueAndDrain("attachment.orphan_sweep", {}, isoWeekKey());
      const archive = await selfEnqueueAndDrain("project.archive", {}, isoWeekKey());
      summary = {
        claimed: sweep.claimed + archive.claimed,
        succeeded: sweep.succeeded + archive.succeeded,
        failed: sweep.failed + archive.failed,
        durationMs: sweep.durationMs + archive.durationMs,
      };
      break;
    }
    case "backup.verify":
      summary = await selfEnqueueAndDrain("backup.verify", {}, todayKey());
      break;
  }

  // 4. A summary for the Vercel log.
  return NextResponse.json(summary);
}
