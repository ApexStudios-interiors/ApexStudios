import type { Role } from "@/lib/rbac/roles";

/**
 * build/07-stock-inventory-notifications.md §2.5. Pure — no `next/*`, no
 * `server-only` (code-standards §1). `rpc_transition_stock_request` is the
 * real enforcement (a UI button existing or not changes nothing at the
 * database); this exists so the row and the per-status button set are
 * derived from the exact same rule instead of two hand-kept lists that can
 * drift — "Do not implement transitions in the UI" (build §5) is about the
 * DECISION, not about being unable to describe what the RPC would allow.
 */
export type StockRequestStatus = "pending" | "approved" | "ordered" | "delivered" | "rejected";

export type StockTransition = { to: Exclude<StockRequestStatus, "pending">; label: string };

const isAdminRole = (role: Role) => role === "owner" || role === "admin";

export function availableTransitions(status: StockRequestStatus, role: Role): StockTransition[] {
  switch (status) {
    case "pending":
      return isAdminRole(role)
        ? [
            { to: "approved", label: "Approve" },
            { to: "rejected", label: "Reject" },
          ]
        : [];
    case "approved":
      return isAdminRole(role) ? [{ to: "ordered", label: "Mark Ordered" }] : [];
    case "ordered":
      return isAdminRole(role) || role === "site" ? [{ to: "delivered", label: "Mark Delivered" }] : [];
    case "delivered":
    case "rejected":
      // Terminal states are terminal (02-lld.md §5.4) — nothing to offer.
      return [];
  }
}
