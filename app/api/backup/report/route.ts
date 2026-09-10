import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * D17 (docs/decisions.md): called by `.github/workflows/backup-nightly.yml`
 * at the end of every run, success or failure, so the outcome lands in the
 * same `jobs` table and Admin ops page as every other job — even though the
 * work itself happened outside this app entirely. `jobs` has no
 * user-writable path and `backup.nightly` is deliberately absent from
 * `rpc_enqueue_job`'s allowlist (it's never enqueued from a user session),
 * so this is the one place besides `lib/jobs/runner.ts` that legitimately
 * needs the service_role client.
 */
const bodySchema = z.object({
  ok: z.boolean(),
  key: z.string().optional(),
  error: z.string().optional(),
});

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json: unknown = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // One row per calendar day (UTC) — a retried workflow run reporting twice
  // in the same day updates the same row rather than piling up duplicates.
  const idempotencyKey = new Date().toISOString().slice(0, 10);
  const finishedAt = new Date().toISOString();

  const { data: existing, error: selectError } = await supabase
    .from("jobs")
    .select("id")
    .eq("name", "backup.nightly")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (selectError) return NextResponse.json({ error: selectError.message }, { status: 500 });

  const patch = {
    status: parsed.data.ok ? ("succeeded" as const) : ("failed" as const),
    last_error: parsed.data.error ?? null,
    finished_at: finishedAt,
  };

  const { error: writeError } = existing
    ? await supabase.from("jobs").update(patch).eq("id", existing.id)
    : await supabase.from("jobs").insert({
        name: "backup.nightly",
        idempotency_key: idempotencyKey,
        payload: { key: parsed.data.key ?? null },
        started_at: finishedAt,
        ...patch,
      });
  if (writeError) return NextResponse.json({ error: writeError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
