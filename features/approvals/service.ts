import type { ApprovalType } from "./schema";

/**
 * build/08-approvals.md §2.4. Pure — no `next/*`, no `server-only`
 * (code-standards §1, AGENTS.md's own layering rule). `rpc_decide_approval`
 * and the RLS freeze on `attachments` (migration 0036) are the real
 * enforcement; this exists so the UI's per-status button set and the aged-
 * approvals telemetry figure are derived from the same rule as everywhere
 * else that cares what "pending" means, instead of a second hand-kept copy.
 */
export type ApprovalStatus = "pending" | "approved" | "rejected";

/** `approval_type`'s real enum values, for the table's Type badge and
 *  `NewApprovalDialog`'s dropdown — replaces the mock's own mismatched
 *  `TYPES` array (`"Material sample" | "Material" | "Drawing" | "Design" |
 *  "Variation"`, none of which are real values). */
const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  material_sample: "Material Sample",
  drawing: "Drawing",
  make_model: "Make/Model",
  milestone: "Milestone",
  other: "Other",
};

export function approvalTypeLabel(type: ApprovalType): string {
  return APPROVAL_TYPE_LABELS[type];
}

/** `ApprovalPhotosDialog` is hidden once decided (build §2.5 step 5) — this
 *  mirrors the RLS freeze (migration 0036's `att_insert`/`att_delete_uploader`
 *  policies), it does not replace it. */
export function canAddPhotos(status: ApprovalStatus): boolean {
  return status === "pending";
}

/** The client's Approve/Reject buttons only ever render for a pending row
 *  (build §2.5 step 2) — combine with `can(role, 'decideApproval')` at the
 *  call site; this half is the status, not the role. */
export function canDecide(status: ApprovalStatus): boolean {
  return status === "pending";
}

/** A rejected approval, and only a rejected one, may be superseded by a
 *  revised request (rpc_create_approval's own check, 01-hld.md §8.2). */
export function canSupersede(status: ApprovalStatus): boolean {
  return status === "rejected";
}

const AGED_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** architecture.md §9.1's "Approvals pending > 7 days" telemetry figure —
 *  computed here, surfaced in Build 10's Admin dashboard (build §2.4's own
 *  instruction: "Compute it here, surface it there"). */
export function isAgedPending(status: ApprovalStatus, createdAt: string, now: Date): boolean {
  if (status !== "pending") return false;
  return now.getTime() - new Date(createdAt).getTime() > AGED_THRESHOLD_MS;
}
