# Build 08 — Client Approvals & Sign-off

> **This file is a prompt.** It is short, and it is the first surface a real client will ever
> touch. The evidentiary value of the whole approval chain depends on one rule: **only a Client
> may decide an approval.**
>
> **Depends on:** Build 06 (attachments and photo upload), Build 03 (client auth).
> **Blocks:** nothing structurally — but it is the first thing to put in front of a real client,
> and doing so before Build 09 de-risks the client login path while the stakes are low.
> **Branch:** `build/08-approvals`

---

## 0. Prerequisites — what a human must do outside the codebase

- [ ] **Confirm the approval type list** with Apex. The schema has
      `material_sample | drawing | make_model | milestone | other` (`02-lld.md` §2). These render
      as badges and become a permanent vocabulary. Confirm before the enum ships — enum values
      cannot be removed.
- [ ] **Reference number format** for approvals, decided alongside D18 in Build 07.
      `AP-BHEL-NCH-007` per the LLD, or the prototype's `AP-001`. One convention, both entities.
- [ ] **Client onboarding, for real.** Before this reaches production:
      - T V Rao (and any other client) has been told an email is coming and from what address;
      - a magic link has been delivered to their actual mailbox and tested on their actual phone,
        not on a desktop in the office;
      - someone has walked them through approving one sample.
      A client who cannot log in cannot approve, and with no email notification in v1
      (ADR-017) nobody finds out until the site is blocked.
- [ ] **Agree the chasing process.** With notification in-app only, a client has **no external
      prompt** that an approval is waiting. `architecture.md` §16.6 asks for confirmation that
      Apex will chase by phone, or for permission to scope WhatsApp/SMS instead — which for
      Indian clients is arguably the better channel anyway. This build makes that gap real. Get
      the answer (A-6) before go-live, not after a sample sits for three weeks.
- [ ] **Confirm the evidentiary framing.** `architecture.md` §12: a client "Approve" click is an
      audited action, **not** a legally binding e-signature. Where a signed record is needed, the
      workflow is: client approves in-app, then Admin uploads the counter-signed PDF as an
      attachment. Make sure Voola and the client both understand this, in writing.

---

## 1. Objective

The approval lifecycle enforced in the database, photo evidence that freezes on decision, and a
client-facing surface that makes "what needs my sign-off" answerable in one click.

---

## 2. Steps

### 2.1 Migration: `rpc_decide_approval`

`rpc_decide_approval(p_approval_id uuid, p_decision approval_status, p_reason text)` —
`security definer`, `set search_path = ''`:

1. Lock the approval row.
2. **`auth_role()` must be `'client'`.** Not admin. Not owner. `FORBIDDEN` otherwise.
3. `is_member_of(project_id)`, else `FORBIDDEN`.
4. Status must be `pending`, else `ILLEGAL_TRANSITION`. A decided approval is terminal and is
   never reopened (`01-hld.md` §8.2).
5. `p_decision` must be `approved` or `rejected`; a rejection requires a reason
   (`REASON_REQUIRED`; `ap_reject_ck` also enforces it).
6. Set `status`, `decided_by = auth.uid()`, `decided_at = now()`, `decision_reason`.
7. `fn_audit('approval', id, 'transition', before, after)`.

**There is no Admin bypass, and none is added later "for testing".** An admin performing a
client's sign-off destroys the audit value of the entire chain (`01-hld.md` §7.1). Where a client
signs off verbally, the offline path is: Admin records an `offline_certification` note and
uploads a scan — a distinct, visibly different action — rather than clicking the client's button.
If that offline path is wanted, scope it explicitly; it is not in this build.

Add `rpc_create_approval` allocating `ref_no` under a project row lock, as in Build 07 §2.1.

### 2.2 Freeze evidence on decision

Once decided, the approval and its attachments are frozen — this is the record that answers
"you approved this finish" eighteen months later during a dispute (`01-hld.md` §8.2).

Enforce it in two places:
- `addSamplePhotos` refuses when `status <> 'pending'`.
- The `attachments` insert policy for `entity_type = 'approval'` checks the parent approval is
  still pending. RLS is the layer that holds when the action layer is wrong.

Also constrain the delete path: `02-lld.md` §6.1 allows an uploader to delete their own
attachment within 24 hours. That must **not** apply to an attachment on a decided approval.
Add the condition, and test it.

### 2.3 Supersession, not reopening

A rejected approval cannot be re-opened. A new approval is raised referencing the old one via
`supersedes_id` (`01-hld.md` §8.2). Implement:

- The Approvals table shows a rejected row with a "Raise revised approval" action for admin/site,
  which opens `NewApprovalDialog` pre-filled from the rejected record with `supersedes_id` set.
- The detail view of a superseding approval links back to what it replaced, and the superseded
  one links forward. A revision history that only points one way is half a record.

### 2.4 `features/approvals/`

**Actions** (`02-lld.md` §7):

| Action | Guard | Notes |
|---|---|---|
| `requestApproval` | admin, site | Up to 4 attachment keys; `neededBy` optional |
| `addSamplePhotos` | admin, site | Pending approvals only |
| `decideApproval` | **client only** | The RPC enforces it; the guard gives a clean error |

**Queries** — approvals are visible to all three roles (`01-hld.md` §7.1), so the shape is the
same for everyone; there are no cost columns on the table. Return the attachments with presigned
thumbnail URLs, the requester's name, and the decision metadata.

Add the aged-approvals figure for Build 10's telemetry: approvals pending more than 7 days
(`architecture.md` §9.1). Compute it here, surface it there.

### 2.5 Convert the surfaces

1. **`app/projects/[projectId]/approvals/page.tsx`** — status filter tabs
   (Pending / Approved / Rejected / All) and the table from `docs/ui-guide.md` §6.10:
   Ref · Item (with package, note, up to four sample thumbnails) · Type badge · Requested ·
   Needed By · Status (with the decided date once resolved) · Actions.
2. **Actions column, by role:**
   - **Client, pending:** **Approve** and **Reject** buttons. This is the sign-off.
   - **Everyone else:** "Add photos", disabled once decided.
   Drive both from `can(role, 'decideApproval')` and the status — never from a role string
   inline in the table component.
3. **Reject** opens a confirm dialog with a **required** reason field. Approve gets a
   confirmation step too: it is a commercially meaningful, irreversible click on a phone.
4. **`NewApprovalDialog`** on the server action, with `FileUploader` for sample photos.
5. **`ApprovalPhotosDialog`** on `addSamplePhotos`, hidden once decided.
6. **`ApprovalTable`** takes props; the prototype's `photos: number` becomes a real attachment
   list.
7. The dashboard's **Pending Approvals** card (the `TODO(build-08)` from Build 04) and the
   client's "Awaiting Your Approval" stat.
8. The photo lightbox from Build 06 — a client deciding on a marble sample needs to see it at
   full size, on a phone. Test that specifically.

### 2.6 The client's path through the product

This is the moment to walk the whole client journey end to end, because it is short and it is the
one an external person will judge the product by:

**bell → "Approval needed: Marble sample" → the approval → photos at full size → Approve → gone
from the bell.**

Every step of that must work on a phone, over mobile data, on the first attempt, for someone who
logs in once a month. Test it on a real device, not a desktop viewport.

---

## 3. Tests

**pgTAP**
- An `admin` session calling `rpc_decide_approval` raises `FORBIDDEN`. Same for `owner` and
  `site`. This is `02-lld.md` §6.3 test 6 and it is non-negotiable.
- A client deciding an approval on a project they are not a member of is refused.
- All three roles can read approvals for their projects.

**Integration**
| Assertion |
|---|
| A client approving a `pending` approval succeeds and stamps `decided_by`, `decided_at` |
| Deciding an already-decided approval raises `ILLEGAL_TRANSITION` |
| Rejecting with an empty reason raises `REASON_REQUIRED` |
| `addSamplePhotos` on a decided approval is refused |
| An attachment insert against a decided approval is refused **by RLS**, with the action layer bypassed |
| An uploader cannot delete an attachment on a decided approval, even within 24 hours |
| `ap_decided_ck` makes "pending with a decided_at" and "approved with no decided_at" both impossible |
| A superseding approval links to the superseded one in both directions |
| Two concurrent `rpc_create_approval` calls produce distinct `ref_no` values |

**Playwright**
- *Client, mobile viewport:* open the bell → pending approval → view a photo full size → Approve
  → the item leaves the bell and the table shows Approved with today's date.
- *Client:* Reject with no reason → blocked with a field-level error.
- *Admin:* the Approve and Reject buttons **do not render**; a hand-crafted POST to
  `decideApproval` is refused by the server.
- *Site:* can request an approval and add photos; cannot decide.
- *Admin:* raise a revised approval from a rejected one; both link to each other.

---

## 4. Verification — exit criteria

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm test:rls && pnpm test:e2e && pnpm build
```

- [ ] The full client journey completed on a **real phone**, on mobile data, signing in from a
      magic link in a real mailbox. Not a simulated viewport.
- [ ] An admin cannot decide an approval through the UI, through a crafted action call, or
      through a direct PostgREST call. Try all three.
- [ ] A decided approval's photos cannot be added to or removed, by anyone, including the
      uploader within 24 hours.
- [ ] Visual parity against `proto-v1` for the approvals table, both themes; the thumbnails now
      show real photos where the prototype showed placeholders.
- [ ] `docs/progress-tracker.md` updated; A-6 (client chasing) answered and recorded.

---

## 5. Guardrails — do not

- **Do not add an Admin path to decide an approval.** Not in the RPC, not in the action, not in a
  test helper, not behind a flag.
- **Do not allow a decided approval to be reopened.** Supersede it.
- **Do not allow photos to be added to or removed from a decided approval.**
- **Do not skip the confirmation step** on Approve. It is irreversible and it is being clicked on
  a phone.
- **Do not describe an in-app approval as a signature** in any user-facing copy. It is an audited
  decision (`architecture.md` §12).
- **Do not add email or SMS notification here.** It is out of scope for v1 (ADR-017) and adding
  it quietly would put an unowned delivery dependency into production.

---

## 6. Deliverables

- [ ] `rpc_decide_approval` (client-only) and `rpc_create_approval` with locked `ref_no`
- [ ] Evidence freeze enforced in both the action layer and RLS, including the delete path
- [ ] Supersession, linked in both directions
- [ ] `features/approvals/` — schema, service, queries, actions
- [ ] Approvals route, dashboard cards and client stat on server data
- [ ] `NewApprovalDialog` and `ApprovalPhotosDialog` on server actions with real uploads
- [ ] Confirmation dialogs for Approve and for Reject-with-reason
- [ ] Tests: pgTAP FORBIDDEN cases, the nine integration assertions, five Playwright journeys
- [ ] The client journey verified on a real device with a real magic link
