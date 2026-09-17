// The prototype's demo dataset — `seedData`, the two hard-coded projects and
// their requests, approvals, bills, team and inventory — is gone. Its last
// three readers were the Sidebar's package sub-list and badge counts, the
// Header's breadcrumb and `hooks/useProject.ts`; all three read real,
// role-scoped, RLS-enforced queries now, and `context/AppContext.tsx` no
// longer seeds any of it. The frozen copy stays in
// `docs/reference/prototype-dataset.ts`, which is what that file is for.
//
// This file could not be deleted outright: `lib/logic.ts` still imports the
// five constants below. They are prototype constants (GST/RET/MAS are
// per-project columns in the real schema — AGENTS.md) and so are the
// `lib/logic.ts` functions that use them, none of which has a caller left;
// retiring those is its own change, not this one's.

export const FLOW = ["Pending", "Approved", "Ordered", "Delivered"] as const;
export const TODAY = new Date("2026-09-07");
export const GST = 18;
export const RET = 5;
export const MAS = 75;
export const L = 100000;
export const CR = 10000000;
