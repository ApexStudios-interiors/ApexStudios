# Runbook: the nightly backup failed

**Trigger.** Any of:

- the red banner across the top of the admin shell ("Last night's database backup failed" or
  "The backup check failed …");
- a `backup.nightly` or `backup.verify` row with status `failed` on **Ops → Failed Jobs**
  (`/ops/jobs`);
- a failed run of the **backup.nightly** workflow in GitHub Actions (GitHub emails the
  workflow's last committer and anyone watching the repository).

**Severity: P1** (AGENTS.md background job rule 7). On the free Supabase tier this dump is the
only recovery point: there is no point-in-time recovery. Every night without one is a day of
site diaries, approvals and bills that cannot be restored.

**You need:** GitHub access to `ApexStudios-interiors/ApexStudios` (Actions tab), admin access to
the app, and Cloudflare dashboard access to R2 (`apex-backups` bucket).

---

## 1. Which check failed?

| Row on Failed Jobs | What it means | Go to |
| --- | --- | --- |
| `backup.nightly` failed | The GitHub workflow itself failed: dump, integrity check or upload | §2 |
| `backup.verify` failed, error starts `NotFound` | No object for today in `apex-backups` at 02:30 IST | §2 (the workflow probably failed or never ran) |
| `backup.verify` failed, `BACKUP_TOO_SMALL` | Today's object exists but is 10 KB or less | §3 |
| `backup.verify` failed, `BACKUP_SHRANK` | Today's object is under half of yesterday's | §3 |
| `backup.verify` failed, `AccessDenied` / `403` | The read-only R2 token Vercel uses cannot read the bucket | §4 |

`backup.verify` retries itself for about half an hour (1, 2, 4, 8, 16 minutes) before it goes
`failed`, so a dump that was only late has already had that long to land.

## 2. The workflow failed or did not run

1. GitHub → **Actions** → **backup.nightly** → open the latest run. Find the red step.
   - **Install …**: a runner image change. Re-run; if it fails again, fix the install step.
   - **Verify pg_dump version**: the PGDG client changed. Check the database's major version
     (Supabase dashboard → Settings → Infrastructure) and match the client to it.
   - **Dump and compress**: usually `SUPABASE_DB_URL` (rotated password, paused project). If the
     project is paused, resume it (`supabase-paused.md`).
   - **Check dump integrity**: `gunzip -t` failed or the "dump complete" footer is missing, so
     pg_dump stopped part-way. Re-run once; if it repeats, the dump is timing out (see the
     job's `timeout-minutes`) or the connection is being dropped.
   - **Upload to R2**: the step prints which of `AccessDenied` (the token is read-only or not
     scoped to `apex-backups`) or `SignatureDoesNotMatch` (key and secret do not belong
     together) it is. Fix the `R2_BACKUP_*` repository secrets.
   - **Report success / failure**: the backup itself is fine; only the report to
     `/api/backup/report` failed. Check `APP_URL` and `CRON_SECRET` repository secrets match
     Vercel's.
2. **No run at all last night?** GitHub disables scheduled workflows after 60 days with no
   commits. Actions → backup.nightly → **Enable workflow**.
3. Re-run by hand once the cause is fixed:

   ```bash
   gh workflow run backup-nightly.yml
   gh run watch "$(gh run list --workflow backup-nightly.yml --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
   ```

4. Then re-check: **Ops → Failed Jobs → Retry** on the `backup.verify` row. The banner clears
   once its next run succeeds.

## 3. The object exists but is too small or shrank

A real dump only grows (nothing is hard-deleted, AGENTS.md database rule 7), so a much smaller
file means the dump is wrong, not the data.

1. Cloudflare → R2 → `apex-backups` → `pg_dump/`: compare today's and yesterday's sizes.
2. Download today's object and inspect it locally (it contains production data: delete the
   local copy afterwards):

   ```bash
   gunzip -t 2026-11-24.sql.gz && gunzip -c 2026-11-24.sql.gz | tail -n 3
   gunzip -c 2026-11-24.sql.gz | grep -c '^COPY public\.'
   ```

   A healthy dump ends with `-- PostgreSQL database dump complete` and has one `COPY` per table.
3. Likely causes: `SUPABASE_DB_URL` pointing at the wrong database, or a dump cut short. Fix,
   then re-run the workflow (§2 step 3). **Never delete yesterday's object** to make the check
   pass: it may now be the newest good recovery point.

## 4. backup.verify cannot read the bucket

Vercel's `backup.verify` uses `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY`, an
**Object Read-only** token scoped to `apex-backups` (D17), falling back to the app token when
unset. Re-issue the read-only token in Cloudflare, update both Vercel env vars, redeploy, and
Retry the job.

## 5. Escalate

- **Two consecutive nights without a verified backup:** stop and treat it as an incident. Tell
  the owner. Until a backup is verified, avoid bulk operations (imports, mass edits).
- If a restore is needed in the meantime, follow `restore-database.md` with the newest object
  that passes `gunzip -t`.
