import { describe, expect, it } from "vitest";
import { billDecisionsFor } from "./decisions";

/** The web client's own rule (BillingClient: Approve/Reject on a submitted
 *  bill, client only), as the mobile API serves it. */
describe("billDecisionsFor", () => {
  it("offers a client certify and reject on a submitted bill", () => {
    expect(billDecisionsFor("client", "submitted")).toEqual(["certify", "reject"]);
  });

  it.each(["draft", "certified", "paid", "cancelled"])("offers a client nothing on a %s bill", (status) => {
    expect(billDecisionsFor("client", status)).toEqual([]);
  });

  it.each(["admin", "site"])("never offers %s a decision, even on a submitted bill", (role) => {
    expect(billDecisionsFor(role, "submitted")).toEqual([]);
  });
});
