/**
 * Which decisions a user may make on a bill right now — the web client's own
 * Bills table rule (BillingClient: Approve and Reject on a `submitted` bill,
 * for a client), as data, so the mobile app shows exactly what the server
 * says instead of deciding for itself. Pure.
 *
 * It only decides what is OFFERED. `rpc_transition_bill` stays the real
 * enforcement: submitted -> certified / submitted -> draft only, client
 * only, a member of the bill's project, a reason to reject.
 */
export type BillDecision = "certify" | "reject";

export function billDecisionsFor(role: string, status: string): BillDecision[] {
  return role === "client" && status === "submitted" ? ["certify", "reject"] : [];
}
