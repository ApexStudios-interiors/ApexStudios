# Build 06 — File Storage, the Background Job Runner & Daily Updates

> **This file is a prompt.** It builds the two pieces of infrastructure every remaining feature
> needs — the R2 upload pipeline and the job runner — and proves both by shipping Daily Updates,
> the simplest surface that uses them.
>
> **Depends on:** Build 02 (`jobs`, `attachments`), Build 03 (session, guards).
> **Blocks:** Build 08 (approval photos), Build 09 (bill PDFs and bill copies), Build 10 (ops).
> **Branch:** `build/06-files-and-jobs`

---

## 0. Prerequisites — what a human must do outside the codebase

### 0.1 Cloudflare R2

- [ ] **Three private buckets exist**: `apex-prod`, `apex-preview`, `apex-backups`. None public.
      No public development URL enabled on any of them.
- [ ] **CORS policy on `apex-prod` and `apex-preview`.** Browsers `PUT` directly to R2
      (`01-hld.md` §9), so without CORS every upload fails with an opaque network error and no
      server-side log. Allow `PUT` and `HEAD` from `https://app.beapex.in`,
      `https://*.vercel.app` and `http://localhost:3000`; allowed headers `content-type`; expose
      `etag`; max age 3600. **Test it with `curl -X OPTIONS` before writing any code** — this is
      the single most common cause of a day lost in this build.
- [ ] **Two separate API tokens**, as set up in Build 01: one scoped to the app buckets, one
      scoped to `apex-backups` only. Confirm the app token genuinely cannot write to the backup
      bucket — try it. A compromised app credential must not be able to destroy the only
      recovery point.
- [ ] **Lifecycle rules**: on `apex-backups`, expire daily backups after 30 days, keep the
      first-of-month objects for 12 months (`architecture.md` §7.2). On `apex-prod`, no expiry —
      attachments are retained indefinitely (`architecture.md` §7.1).
- [ ] **Storage alert** configured at 8 GB (approaching the 10 GB free allowance).

### 0.2 Vercel

- [ ] **Vercel Pro active.** The Hobby tier allows only a couple of cron invocations per day at
      fixed times and cannot run the per-minute drain (`01-hld.md` §10.3). Without Pro this
      build's design does not work.
- [ ] **`CRON_SECRET` set** in Production and Preview environment variables.
- [ ] **Confirm the function timeout and memory** available on the plan. `sharp` thumbnailing a
      10 MB JPEG and `@react-pdf/renderer` (Build 09) both need headroom; the defaults may not be
      enough, and finding out from a production timeout is expensive.

### 0.3 Decisions to close

- [ ] **A-4: antivirus scanning of uploads.** Excluded in v1 (`architecture.md` §16.4). Site
      photos arrive from supervisors' personal phones, so confirm this explicitly rather than by
      omission. Mitigations without AV: strict MIME allowlist, size caps, private bucket, and
      `Content-Disposition: attachment` on every download so nothing renders inline.
- [ ] **D17 — where does `backup.nightly` actually run?** See §3.6. This needs an answer before
      the job is written, and the honest answer is *not* "a Vercel function".
- [ ] **Daily update edit window.** `02-lld.md` §3.7 gives an author 24 hours to edit, then
      freezes the record, because updates are site-diary evidence backing RA bills. Confirm 24
      hours is right for Apex.

---

## 1. Objective

Three things, in this order:

1. A presigned direct-to-R2 upload pipeline that never records a file it has not verified exists.
2. A job runner with claim/lease/retry/reap semantics, driven by Vercel Cron, with state in
   Postgres.
3. Daily Updates on real data with real photos — the first consumer of both.

---

## 2. Steps — file storage

### 2.1 `lib/r2/`

- `client.ts` — an `S3Client` pointed at the R2 S3 endpoint, credentials from `lib/env.ts`.
  `import 'server-only'`.
- `keys.ts` — the key layout from `01-hld.md` §9:
  ```
  org/{org_id}/project/{project_id}/{entity}/{entity_id}/{uuid}-{safe_filename}
  ```
  `safe_filename` is aggressively sanitised: strip path separators, control characters and
  leading dots; transliterate to ASCII; cap at 100 characters; keep the extension. The key
  embeds the ownership path so an orphaned object stays traceable and lifecycle rules can be
  scoped per project on archive.
- `presign.ts` — `presignPut(key, mime, size)` with a **5-minute** TTL,
  `presignGet(key)` with a **15-minute** TTL (`01-hld.md` §9).
- `head.ts` — `headObject(key)` returning size and etag, used by the confirm step.
- `constraints.ts` — the allowlist, as data, exported for both the server check and the client
  input `accept` attribute:
  ```ts
  export const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
  export const DOC_MIME   = ['application/pdf'] as const;
  export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
  export const MAX_DOC_BYTES   = 25 * 1024 * 1024;   // 25 MB
  export const MAX_PHOTOS_PER_ENTITY = 4;             // matches the UI's 4-photo grids
  ```

### 2.2 `features/attachments/`

Three actions, per `02-lld.md` §7 and `01-hld.md` §9:

**`requestUploadUrl({ entityType, entityId, fileName, mimeType, sizeBytes })`**
1. `requireSession`, then `requireProjectAccess` for the entity's project.
2. Check the MIME allowlist and the size cap **server-side**. The client's `accept` attribute is
   a convenience, not a control.
3. Check the per-entity photo cap (4).
4. Build the key, presign the `PUT`, return `{ url, key }`.
   No `attachments` row is written yet.

**`confirmUpload({ key, entityType, entityId, fileName, mimeType, sizeBytes })`**
1. Re-check auth and that the key's embedded org/project match the session's access. A key is
   user-supplied input; do not trust its path.
2. **`HeadObject` the key.** If the object does not exist, or its size does not match what was
   declared, fail and write nothing.
3. Insert the `attachments` row.
4. Enqueue `attachment.thumbnail` with `idempotency_key = attachment.id`.
5. Return the attachment id.

Step 2 is the whole reason the flow has two steps. Without it, an abandoned upload leaves a
database row pointing at nothing, and every photo grid in the app has to handle a broken image.
**We record only what we can verify.**

**`getDownloadUrl({ attachmentId })`** — access check, then a 15-minute presigned `GET` with
`ResponseContentDisposition: attachment` for anything that is not an image being rendered in a
grid. Never store or cache the signed URL.

### 2.3 The uploader component

`components/upload/FileUploader.tsx` — a client component, used by `PostUpdateDialog`,
`NewApprovalDialog`, `ApprovalPhotosDialog` (Build 08) and `BillUploadDialog` (Build 09).

- Accepts `entityType`, `entityId`, `accept`, `maxFiles`, `maxBytes`.
- Per file: request URL → `PUT` with progress → confirm. Uploads run in parallel, capped at three.
- A failed `PUT` shows an inline retry on that file only. The rest of the form still submits —
  a supervisor on site with two bars of signal must be able to post the text of an update even
  when a photo fails (`architecture.md` §8.4).
- Shows the existing photo-placeholder treatment while uploading, so the grid does not reflow.
- Client-side validation mirrors `constraints.ts` for a fast error, and the server re-checks.

### 2.4 Rendering attachments

- Photo grids use the `thumb_r2_key` presigned URL, falling back to the full object if the
  thumbnail job has not run yet. The UI's 4-photo grids must not pull four 5 MB site photos
  (`01-hld.md` §9).
- Add a lightbox for full-size viewing, built from the existing `DialogShell`.
- `next/image` cannot optimise a private presigned URL; render with a plain `<img>` and explicit
  `width`/`height` from the stored dimensions, or accept unoptimised images. Do not add the R2
  domain to `next.config.ts` `remotePatterns` and assume it works — presigned URLs expire and the
  optimiser will cache a dead one.

---

## 3. Steps — the job runner

### 3.1 `lib/jobs/`

```
lib/jobs/
  enqueue.ts     enqueue(name, payload, { idempotencyKey, runAfter })
  runner.ts      claim → dispatch → finish, with per-job timing and Sentry scope
  registry.ts    name → handler map; the single place a job name exists
  handlers/
    attachment.thumbnail.ts
    attachment.orphan-sweep.ts
    inventory.reconcile.ts        (Build 07 fills this in)
    bill.pdf.ts                   (Build 09 fills this in)
    project.archive.ts
```

`enqueue` writes a `jobs` row through a `security definer` helper — users have no insert policy
on `jobs` (Build 02 §4.7).

`runner.claim()` calls `rpc_claim_jobs` (never a plain `select … where status='pending'`); the
`for update skip locked` inside it is what stops two overlapping cron ticks from double-running
work. `runner.finish()` calls `rpc_finish_job`, which applies the 1/2/4/8/16-minute exponential
backoff and moves a job to terminal `failed` at `max_attempts`.

**Every handler must be idempotent.** Assume every job runs at least twice
(`AGENTS.md` background job rule 1). A thumbnail handler that has already produced its output
should notice and return success, not re-render.

### 3.2 The cron route

`app/api/cron/[job]/route.ts`:

1. Reject any request without `Authorization: Bearer ${CRON_SECRET}` — **401, before anything
   else**, including before parsing the job name.
2. Validate the job name against `registry.ts`. An unknown name is a 404, not a 500.
3. Claim a bounded batch, dispatch, finish. **Do no real work in the route handler**
   (`AGENTS.md` background job rule 3) — the handlers stay pure and unit-testable.
4. Return a summary `{ claimed, succeeded, failed, durationMs }` for the Vercel log.
5. Guard the total elapsed time against the function timeout: stop claiming new work at 80% of
   the budget and leave the rest for the next tick. A job killed mid-flight is what the lease and
   the reaper exist for, but not needing them is better.

### 3.3 Cron registration

Add to `vercel.json` (`02-lld.md` §3.10):

```json
{ "crons": [
  { "path": "/api/cron/jobs.drain",         "schedule": "* * * * *"   },
  { "path": "/api/cron/jobs.reap",          "schedule": "0 * * * *"   },
  { "path": "/api/cron/inventory.reconcile","schedule": "30 20 * * *" },
  { "path": "/api/cron/weekly.maintenance", "schedule": "0 21 * * 0"  }
]}
```

**Vercel cron schedules are UTC. IST is UTC+5:30.** `30 20` UTC is 02:00 IST. Getting this wrong
runs the reconcile during the working day (`AGENTS.md` background job rule 4). Put the IST time
in a comment next to every entry.

`backup.nightly` is deliberately absent from this list — see §3.6.

### 3.4 `jobs.reap`

Hourly. Requeues jobs whose `lease_until` has passed, meaning the worker died mid-run:

```sql
update public.jobs
   set status = 'pending', lease_until = null,
       last_error = 'lease expired — worker timed out'
 where status = 'running' and lease_until < now();
```

### 3.5 `attachment.thumbnail` and `attachment.orphan_sweep`

**Thumbnail:** fetch the object, `sharp` resize to 400 px on the long edge, strip EXIF (site
photos carry GPS coordinates — that is location data about a client's property and it should not
survive into storage), write to the `thumb/` prefix, update `attachments.thumb_r2_key`. Skip
non-images. Idempotent: if `thumb_r2_key` is already set and the object exists, return success.

**Orphan sweep** (weekly): list R2 keys with no matching `attachments` row, older than 24 hours,
and delete them. The 24-hour floor is essential — a shorter window races the confirm step and
deletes files that are mid-upload. Log every deletion. Consider a dry-run mode for the first
month in production, and read the log before enabling deletion.

### 3.6 `backup.nightly` — read this before writing it

`01-hld.md` §10.2 and `architecture.md` §7.2 specify a nightly `pg_dump` to R2, run from
`/api/cron/backup.nightly`, and both call its failure a **P1** because it is the only recovery
point on a tier without point-in-time recovery.

**A Vercel serverless function cannot do this.** There is no `pg_dump` binary in the runtime, the
function timeout is far shorter than a growing logical dump, and streaming a multi-hundred-megabyte
dump through a serverless function to R2 is not a mechanism anyone should depend on for disaster
recovery.

Resolve as **D17**, choosing one:

- **(A) Recommended — a scheduled GitHub Actions workflow.** `ubuntu-latest` has `pg_dump`;
  run it nightly at 19:30 UTC, pipe to `gzip`, upload to `apex-backups` with the AWS CLI, then
  call an authenticated endpoint that records the outcome in the `jobs` table so the Admin ops
  page and the alerting still see it. Full control of the timeout, a real `pg_dump`, no new
  vendor, and it is fifteen lines of YAML.
- **(B) Supabase's own Pro-tier backups plus PITR**, with the nightly dump kept only as a
  secondary, off-provider copy. If ADR-016 (Pro at go-live) is confirmed, this is genuinely
  sufficient for RPO — but keep an independent copy: a backup that lives only inside the account
  that might be lost is not a backup.
- **(C)** A small always-on worker (Fly/Railway, ap-south) that owns the dump. Most control,
  most operational surface, and `architecture.md` §1 principle 3 argues against it.

Whichever is chosen, the **alert asserts that an object was actually written to `apex-backups`,
not merely that the handler did not throw** (`01-hld.md` §10.3). Write that check as a separate
scheduled assertion at 02:30 IST that lists the bucket and fires if today's object is missing.
An unverified backup is a belief, not a control.

Record D17 in `docs/decisions.md` and amend `architecture.md` §7.2 and `01-hld.md` §10.2 to match
what was actually built.

### 3.7 Failed-job visibility

A minimal admin surface now, expanded in Build 10: `app/(app)/ops/jobs/page.tsx`, admin-only,
listing `status = 'failed'` rows with name, payload, attempts, `last_error` and `finished_at`,
plus a `retryJob` action that resets the row to `pending`. `jobs` has an admin-only select policy
and no user-writable path, so the retry action goes through a `security definer` helper.

---

## 4. Steps — Daily Updates

### 4.1 `features/updates/`

- **`postDailyUpdate({ projectId, packageId, updateDate, body, attachmentKeys })`** — `siteAction`,
  at most 4 attachment keys, body required. Confirms each key belongs to this session and this
  project before linking it.
- **`editDailyUpdate`** — author only, within 24 hours. The RLS policy already enforces it
  (`02-lld.md` §6.2); the action returns a clean error rather than an empty update.
- **`queries.ts`** — `getUpdatesForProject(session, projectId, { packageId?, cursor })`,
  ordered by `update_date desc`, with attachments joined and presigned thumbnail URLs generated
  per row. Paginate — a two-year site diary is thousands of entries.

### 4.2 Convert the surfaces

- `app/projects/[projectId]/updates/page.tsx` — the timeline, the package filter dropdown, and
  **+ Post Update** hidden for the client role.
- `packages/[moduleId]/updates/page.tsx` — filtered to one package.
- The Latest Updates card on the project dashboard (the `TODO(build-06)` left by Build 04).
- `PostUpdateDialog` on the server action, with `FileUploader` replacing the photo placeholder.
- `UpdateList.tsx` takes props; photo counts become real thumbnails; the "mentions" field (`men`)
  in the prototype type is unused — drop it rather than carrying a dead field into the DTO.

**Render update bodies as plain text.** No `dangerouslySetInnerHTML`, no markdown renderer
(`architecture.md` §6.5). Preserve line breaks with CSS, not with HTML injection.

---

## 5. Tests

**Unit**
- Key builder: path traversal (`../../etc/passwd`), unicode filenames, a 300-character name, a
  name with no extension, a double extension (`x.pdf.exe`).
- MIME and size validation at each boundary, one byte either side.
- Sentry redaction still strips money fields from job error payloads.

**Integration**
| ID | Assertion |
|---|---|
| T-18 | `confirmUpload` for a key that was never `PUT` fails and writes **no** `attachments` row |
| — | `confirmUpload` with a size that disagrees with `HeadObject` is rejected |
| — | A key whose embedded `project_id` differs from the entity's project is rejected |
| T-19 | A client cannot get a download URL for another project's attachment |
| T-21 | Two concurrent `rpc_claim_jobs` calls never return the same row |
| T-22 | A job exceeding `max_attempts` lands in `failed`, not an infinite retry loop |
| T-23 | The reaper requeues a job whose `lease_until` has passed |
| T-24 | Enqueuing the same `(name, idempotency_key)` twice creates one row |
| T-25 | `/api/cron/*` without the correct `CRON_SECRET` returns **401** |
| — | An unknown job name returns 404 and claims nothing |
| — | Running `attachment.thumbnail` twice produces one thumbnail and two successes |
| — | The orphan sweep does not delete an object younger than 24 hours |
| — | A daily update edited at 25 hours is refused |

**Playwright**
- *Site:* post a daily update with two photos on a throttled connection → the update appears with
  thumbnails once the drain runs.
- *Site:* one photo fails to upload → inline retry appears, the text update still posts.
- *Client:* the **+ Post Update** button is absent, and the route rejects a direct POST.

---

## 6. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build
curl -X GET  https://<preview>/api/cron/jobs.drain                      # 401
curl -H "Authorization: Bearer $CRON_SECRET" https://<preview>/api/cron/jobs.drain  # 200
```

- [ ] CORS verified with a real browser `PUT` from the preview deployment, not just locally.
- [ ] An uploaded photo appears in the grid as a thumbnail within 60 seconds on the preview
      deployment, proving the per-minute drain works on Vercel Pro.
- [ ] Kill a job mid-run (deploy during a drain, or set `lease_until` to the past) and confirm
      the reaper requeues it within the hour.
- [ ] A 12 MB JPEG is rejected at presign, and again at confirm if the presign is replayed.
- [ ] The R2 bucket has no public access. Fetch an object URL without a signature → denied.
- [ ] EXIF GPS data is absent from a generated thumbnail.
- [ ] D17 answered, `backup.nightly` implemented per that answer, and **a real backup object
      exists in `apex-backups`** — verified by listing the bucket, not by reading a log line.
- [ ] `docs/progress-tracker.md` updated; `architecture.md` §7.2 amended for D17.

---

## 7. Guardrails — do not

- **Do not make any bucket public**, or enable an R2 public development URL, for any reason.
- **Do not write an `attachments` row before `HeadObject` confirms the object.**
- **Do not do real work in the cron route handler.** Claim, dispatch, record.
- **Do not `select … where status='pending'`** to claim jobs. Use `rpc_claim_jobs`.
- **Do not add a job for work that fits in a request** (`AGENTS.md` background job rule 6).
- **Do not write a cron schedule in IST.** Vercel is UTC; comment the IST equivalent.
- **Do not trust a client-supplied key.** Re-derive and re-check ownership.
- **Do not render update bodies as HTML.**
- **Do not claim the backup works** because the job returned success. Assert the object exists.
- **Do not let the `service_role` client escape `lib/jobs/handlers/**`.**

---

## 8. Deliverables

- [ ] `lib/r2/` — client, keys, presign, head, constraints
- [ ] `features/attachments/` — request, confirm (with `HeadObject`), download
- [ ] `FileUploader` with per-file retry and partial-failure tolerance
- [ ] Thumbnail rendering and lightbox
- [ ] `lib/jobs/` — enqueue, runner, registry, handlers
- [ ] `/api/cron/[job]` with Bearer auth and a time budget
- [ ] `vercel.json` crons, each commented with its IST time
- [ ] `jobs.reap`, `attachment.thumbnail`, `attachment.orphan_sweep`, `project.archive`
- [ ] `backup.nightly` implemented per D17, **plus the object-existence assertion**
- [ ] Admin failed-jobs page with retry
- [ ] `features/updates/` and the three update surfaces on server data
- [ ] Tests T-18 through T-25 plus the unit and Playwright sets above
- [ ] `docs/decisions.md` (D17) and `architecture.md` §7.2 updated to match reality
