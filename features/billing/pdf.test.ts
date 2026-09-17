import { describe, expect, it } from "vitest";
import { billPdfFileName, billPdfJobKey } from "./pdf";

/**
 * 100% branch on the billing change these two functions carry (AGENTS.md's
 * own testing table). The properties that matter are relational — the same
 * (bill, revision) must always produce the same key, and two revisions of
 * one bill must never produce the same key or the same file name — so they
 * are asserted as properties, not only as literal strings.
 */

const BILL_A = "11111111-1111-4111-8111-111111111111";
const BILL_B = "22222222-2222-4222-8222-222222222222";

describe("billPdfJobKey", () => {
  it("is stable for the same bill and revision — a double-clicked Submit enqueues one job", () => {
    expect(billPdfJobKey(BILL_A, 1)).toBe(billPdfJobKey(BILL_A, 1));
    expect(billPdfJobKey(BILL_A, 1)).toBe(`${BILL_A}:submitted:r1`);
  });

  it("changes on the next revision, so a resubmitted bill is not swallowed by jobs_idem_uq", () => {
    expect(billPdfJobKey(BILL_A, 2)).not.toBe(billPdfJobKey(BILL_A, 1));
    expect(billPdfJobKey(BILL_A, 3)).not.toBe(billPdfJobKey(BILL_A, 2));
  });

  it("never collides with the pre-fix revision-blind key, so an already-submitted bill is unaffected", () => {
    expect(billPdfJobKey(BILL_A, 1)).not.toBe(`${BILL_A}:submitted`);
  });

  it("is per bill, not per revision number", () => {
    expect(billPdfJobKey(BILL_A, 1)).not.toBe(billPdfJobKey(BILL_B, 1));
  });
});

describe("billPdfFileName", () => {
  it("revision 1 keeps the plain bill number — the name clients already download", () => {
    expect(billPdfFileName("RA-BHEL-NCH-03", 1)).toBe("RA-BHEL-NCH-03.pdf");
  });

  it("a later revision gets its own name, so the handler regenerates instead of returning early", () => {
    expect(billPdfFileName("RA-BHEL-NCH-03", 2)).toBe("RA-BHEL-NCH-03-R2.pdf");
    expect(billPdfFileName("RA-BHEL-NCH-03", 10)).toBe("RA-BHEL-NCH-03-R10.pdf");
  });

  it("every revision of one bill has a distinct name", () => {
    const names = [1, 2, 3, 4].map((r) => billPdfFileName("RA-BHEL-NCH-03", r));
    expect(new Set(names).size).toBe(names.length);
  });

  it("is always a .pdf, whichever branch produced it", () => {
    expect(billPdfFileName("RA-BHEL-NCH-03", 1).endsWith(".pdf")).toBe(true);
    expect(billPdfFileName("RA-BHEL-NCH-03", 2).endsWith(".pdf")).toBe(true);
  });

  it("a bill number past 99 is carried through whole — the bill_no truncation bug is not reintroduced", () => {
    expect(billPdfFileName("RA-BHEL-NCH-174", 1)).toBe("RA-BHEL-NCH-174.pdf");
    expect(billPdfFileName("RA-BHEL-NCH-174", 2)).toBe("RA-BHEL-NCH-174-R2.pdf");
  });
});
