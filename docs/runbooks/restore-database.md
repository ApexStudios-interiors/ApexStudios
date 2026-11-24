# Runbook: restore the database from a nightly backup

**Trigger.** Data loss or corruption in the production Supabase project: rows deleted or
overwritten by mistake, a bad migration, or the project itself lost.

**Recovery point.** The newest object in R2 `apex-backups/pg_dump/YYYY-MM-DD.sql.gz`, written by
`.github/workflows/backup-nightly.yml` at 01:00 IST. On the free tier there is no point-in-time
recovery, so **everything after that dump is lost** (RPO 24 hours, architecture.md §7.2). Target
time to restore: 4 hours.

**Never restore over production in place.** There is exactly one Supabase project and it is
production (D49). Restore into a **new** project, verify it, and only then point the app at it.

**You need:** Cloudflare R2 access to `apex-backups`, Supabase dashboard access (to create a
project), Vercel access (env vars), PostgreSQL 17 client tools (`psql`, `pg_restore` not needed:
the dump is plain SQL), and the repository checked out.

---

## 1. Decide what you are restoring

1. Write down the time the damage happened. The dump to use is the newest one **before** it.
2. If only a few rows are wrong, a full restore is usually the wrong tool. Restore into a
   scratch project (§2–§4), copy the affected rows out, and repair production with compensating
   writes through the normal RPCs. Stop after §4.

## 2. Fetch and check the dump

1. Download `pg_dump/YYYY-MM-DD.sql.gz` from R2 (Cloudflare dashboard, or the AWS CLI with the
   R2 endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`).
2. Check it is complete:

   ```bash
   gunzip -t YYYY-MM-DD.sql.gz
   gunzip -c YYYY-MM-DD.sql.gz | tail -n 3   # must end "-- PostgreSQL database dump complete"
   ```

   If it fails, use the previous day's object.

## 3. Restore into a new project

1. Supabase dashboard → **New project**, region `ap-south-1`, same Postgres major version (17).
2. Copy its connection string (Settings → Database → Connection string, session mode) as
   `RESTORE_URL`. Double-check it is **not** the production project ref.
3. The dump was taken with `--no-owner --no-privileges` and contains the `public` schema plus
   Supabase-managed schemas. Restore:

   ```bash
   gunzip -c YYYY-MM-DD.sql.gz | psql "$RESTORE_URL" -v ON_ERROR_STOP=0 2>restore-errors.log
   ```

   Errors about objects that already exist in a fresh Supabase project (extensions, `auth`,
   `storage`, roles) are expected. Errors in `public` are not: read `restore-errors.log`.
4. RLS policies are part of the dump; **GRANT/REVOKE statements are not** (`--no-privileges`).
   A new Supabase project's default privileges re-grant tables and functions in `public` to
   `anon`, `authenticated` and `service_role` as they are created, so the migrations'
   **revokes** (service_role-only RPCs such as `rpc_claim_jobs`) must be re-applied, along with
   their grants. Every grant and revoke in the migrations is a single line, so:

   ```bash
   cat supabase/migrations/*.sql | grep -E '^\s*(grant|revoke) ' | psql "$RESTORE_URL" -v ON_ERROR_STOP=1
   ```

   The pgTAP suite in §4 is what proves the result (it asserts, for example, that the job RPCs
   are not executable by `authenticated`). This step is the one most worth rehearsing in the
   quarterly drill.

## 4. Verify before switching anything

1. Point the pgTAP suite at the restored database (never at production):

   ```bash
   SUPABASE_DB_URL="$RESTORE_URL" pnpm test:rls
   ```

   The policy matrix must be green: it is what proves a client still cannot read internal cost.
2. Spot-check: latest bill's figures (`bills` gross → taxable → GST → net), newest daily update,
   row counts of `projects`, `stock_movements`, `audit_log` against what you expect.
3. Record what is missing (everything after the dump time) and tell the owner before switching.

## 5. Switch the app to the restored project (full restore only)

1. In the new project: Auth → hooks → register `custom_access_token_hook` exactly as
   `supabase/config.toml` does, and re-create users' auth records if `auth` was not restored.
2. Vercel → Settings → Environment Variables (Production): `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`. GitHub
   repository secrets: `SUPABASE_DB_URL`, `SUPABASE_PROD_PROJECT_REF`.
3. Redeploy. Check `/api/health` reports `db: ok`, sign in as each role, open a project.
4. Run the backup workflow by hand (`gh workflow run backup-nightly.yml`) so the new project has
   a verified backup tonight, not tomorrow.

## 6. Afterwards

- Keep the old project paused (not deleted) for 30 days in case something needs to be copied.
- Write up what was lost and why in `docs/decisions.md`.
- The quarterly drill (`restore-drill.md`, architecture.md §7.2) is this runbook end to end into
  a scratch project, stopping after §4.
