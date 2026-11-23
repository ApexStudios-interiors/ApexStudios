import { describe, expect, it } from "vitest";
import {
  LOCATION_MAX_LENGTH,
  MEMBER_GRANT_REFUSAL_COPY,
  MEMBER_REMOVAL_REFUSAL_COPY,
  PACKAGE_NAME_MAX_LENGTH,
  PROJECT_ARCHIVED_COPY,
  PROJECT_COMPLETED_COPY,
  PROJECT_STATUSES,
  PROJECT_STATUS_MOVE_HINT,
  isProjectReopen,
  isProjectStatusTransitionAllowed,
  isSameProjectName,
  isValidLocation,
  isValidPackageName,
  isValidPercent,
  lastProjectRemovalNote,
  memberGrantRefusal,
  memberRemovalRefusal,
  mobilisationAdvanceRefusal,
  normalisePackageNames,
  parseProjectStatus,
  projectCodeBase,
  projectEditRefusal,
  projectWriteRefusal,
  setupChecklist,
  showSetupChecklist,
  targetEndDateRefusal,
  type SetupFacts,
} from "./service";

/** The shape projects_code_ck enforces (migration 0004). */
const CODE_CK = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

describe("projectCodeBase", () => {
  it("reproduces the seeded project's code from its name", () => {
    expect(projectCodeBase("BHEL Nagnar Club House")).toBe("BHEL-NCH");
  });

  it("uses the first word whole and initials for the rest", () => {
    expect(projectCodeBase("Model Villas Interiors")).toBe("MODEL-VI");
  });

  it("skips stopwords when taking initials", () => {
    expect(projectCodeBase("Villa of the Palms and Pools")).toBe("VILLA-PP");
  });

  it("treats punctuation as a word break", () => {
    expect(projectCodeBase("apex/studio: office & showroom")).toBe("APEX-SOS");
  });

  it("caps the first word at 8 and the initials at 6", () => {
    expect(projectCodeBase("Supercalifragilistic a b c d e f g h")).toBe("SUPERCAL-BCDEFG");
  });

  it("uses a single word on its own", () => {
    expect(projectCodeBase("Residence")).toBe("RESIDENC");
  });

  it("pads a too-short base to the constraint's minimum of 3", () => {
    expect(projectCodeBase("AB")).toBe("ABX");
  });

  it("falls back when the name has no letters or digits", () => {
    expect(projectCodeBase("— !")).toBe("PRJ");
  });

  it("always satisfies projects_code_ck", () => {
    for (const name of ["x", "BHEL Nagnar Club House", "a-b-c", "12 34", "Ünïcødé Villa"]) {
      const base = projectCodeBase(name);
      expect(base).toMatch(CODE_CK);
      expect(base.length).toBeGreaterThanOrEqual(3);
      expect(base.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("isValidLocation", () => {
  it("accepts a real address", () => {
    expect(isValidLocation("Ghanpur, Hyderabad")).toBe(true);
  });

  it("rejects a phone number on its own", () => {
    expect(isValidLocation("98765456789")).toBe(false);
  });

  it("rejects digits and punctuation with no letter anywhere", () => {
    expect(isValidLocation("+91 98765-45678")).toBe(false);
    expect(isValidLocation("123456")).toBe(false);
    expect(isValidLocation("!@#$%")).toBe(false);
  });

  it("stays optional — empty and whitespace-only are fine", () => {
    expect(isValidLocation("")).toBe(true);
    expect(isValidLocation("   ")).toBe(true);
  });

  it("accepts a non-Latin script", () => {
    expect(isValidLocation("హైదరాబాద్")).toBe(true);
  });

  it("caps the length at 200 characters, measured after trimming", () => {
    expect(isValidLocation("A".repeat(LOCATION_MAX_LENGTH))).toBe(true);
    expect(isValidLocation("A".repeat(LOCATION_MAX_LENGTH + 1))).toBe(false);
    expect(isValidLocation(`  ${"A".repeat(LOCATION_MAX_LENGTH)}  `)).toBe(true);
  });
});

describe("isValidPackageName", () => {
  it("accepts the names the owner listed", () => {
    for (const name of ["Interiors", "MEP", "Facade", "MEP & HVAC", "Block-A / Tower 2"]) {
      expect(isValidPackageName(name)).toBe(true);
    }
  });

  it("accepts a dot and a digit", () => {
    expect(isValidPackageName("Phase 2.1")).toBe(true);
  });

  it("rejects punctuation soup", () => {
    expect(isValidPackageName("Facade !@#$%^&*")).toBe(false);
  });

  it("rejects an empty or whitespace-only entry", () => {
    expect(isValidPackageName("")).toBe(false);
    expect(isValidPackageName("   ")).toBe(false);
  });

  it("measures 1–60 characters after trimming", () => {
    expect(isValidPackageName(` ${"A".repeat(PACKAGE_NAME_MAX_LENGTH)} `)).toBe(true);
    expect(isValidPackageName("A".repeat(PACKAGE_NAME_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("normalisePackageNames", () => {
  it("splits nothing — it trims, drops blanks and drops duplicates", () => {
    expect(normalisePackageNames(["Interiors", " MEP ", "", "   ", "Facade"])).toEqual([
      "Interiors",
      "MEP",
      "Facade",
    ]);
  });

  it("drops a case-insensitive duplicate, keeping the first spelling", () => {
    expect(normalisePackageNames(["Interiors", "interiors", "INTERIORS"])).toEqual(["Interiors"]);
  });

  it("leaves an empty submission empty", () => {
    expect(normalisePackageNames([])).toEqual([]);
    expect(normalisePackageNames(["", " "])).toEqual([]);
  });
});

describe("isSameProjectName", () => {
  it("ignores case and surrounding whitespace", () => {
    expect(isSameProjectName("Model Villas", " model villas ")).toBe(true);
  });

  it("does not treat different names as the same", () => {
    expect(isSameProjectName("Model Villas", "Model Villas 2")).toBe(false);
  });
});

describe("memberRemovalRefusal (D51, generalised for APX-12)", () => {
  // Whether it is their only project does not matter (owner decision, 2026-11-23).
  it.each(["client", "site"])("allows removing a %s who is on the project", (role) => {
    expect(memberRemovalRefusal({ role, isMember: true })).toBeNull();
  });

  it.each(["client", "site"])("refuses a %s who is not on the project", (role) => {
    expect(memberRemovalRefusal({ role, isMember: false })).toBe("not_member");
  });

  it.each(["admin", "owner"])("refuses a %s — implicit member, no row", (role) => {
    expect(memberRemovalRefusal({ role, isMember: true })).toBe("implicit_member");
  });

  it("refuses the other role than the card manages", () => {
    expect(memberRemovalRefusal({ role: "site", isMember: true, expectedRole: "client" })).toBe("wrong_role");
    expect(memberRemovalRefusal({ role: "client", isMember: true, expectedRole: "site" })).toBe("wrong_role");
    expect(memberRemovalRefusal({ role: "site", isMember: true, expectedRole: "site" })).toBeNull();
  });

  it("has copy for every refusal", () => {
    for (const reason of ["implicit_member", "not_member", "wrong_role"] as const) {
      expect(MEMBER_REMOVAL_REFUSAL_COPY[reason]).toBeTruthy();
    }
  });
});

describe("memberGrantRefusal (APX-12)", () => {
  it("allows a client or a site supervisor", () => {
    expect(memberGrantRefusal({ role: "client" })).toBeNull();
    expect(memberGrantRefusal({ role: "site", expectedRole: "site" })).toBeNull();
  });

  it("refuses an admin and the wrong role", () => {
    expect(memberGrantRefusal({ role: "admin" })).toBe("implicit_member");
    expect(memberGrantRefusal({ role: "client", expectedRole: "site" })).toBe("wrong_role");
    expect(MEMBER_GRANT_REFUSAL_COPY.wrong_role).toBeTruthy();
  });

  it("names the right way back on a last-project removal", () => {
    expect(lastProjectRemovalNote("client")).toContain("Add existing client");
    expect(lastProjectRemovalNote("site")).toContain("Site team");
  });
});

describe("project status transitions (APX-11)", () => {
  // The same eight pairs pgTAP asserts against fn_project_status_transition_allowed.
  const LEGAL = [
    "active>completed",
    "active>on_hold",
    "archived>completed",
    "completed>active",
    "completed>archived",
    "on_hold>active",
    "on_hold>completed",
    "planning>active",
  ];

  it("allows exactly the documented transitions", () => {
    const allowed: string[] = [];
    for (const from of PROJECT_STATUSES) {
      for (const to of PROJECT_STATUSES) {
        if (isProjectStatusTransitionAllowed(from, to)) allowed.push(`${from}>${to}`);
      }
    }
    expect(allowed.sort()).toEqual(LEGAL);
  });

  it("never allows staying put or going back to planning", () => {
    for (const s of PROJECT_STATUSES) {
      expect(isProjectStatusTransitionAllowed(s, s)).toBe(false);
      expect(isProjectStatusTransitionAllowed(s, "planning")).toBe(false);
    }
  });

  it("treats only the two walk-backs as a reopen", () => {
    expect(isProjectReopen("completed", "active")).toBe(true);
    expect(isProjectReopen("archived", "completed")).toBe(true);
    expect(isProjectReopen("on_hold", "active")).toBe(false);
    expect(isProjectReopen("completed", "archived")).toBe(false);
  });

  it("parses only real statuses", () => {
    expect(parseProjectStatus("on_hold")).toBe("on_hold");
    expect(parseProjectStatus("On Hold")).toBeNull();
    expect(parseProjectStatus(null)).toBeNull();
  });

  it("has a hint for every status", () => {
    for (const s of PROJECT_STATUSES) expect(PROJECT_STATUS_MOVE_HINT[s]).toBeTruthy();
  });
});

describe("projectWriteRefusal (APX-41)", () => {
  it("refuses everything on an archived project", () => {
    for (const kind of ["edit", "stock_request", "daily_update"] as const) {
      expect(projectWriteRefusal("archived", kind)).toBe(PROJECT_ARCHIVED_COPY);
    }
  });

  it("refuses only new stock requests and daily updates on a completed project", () => {
    expect(projectWriteRefusal("completed", "stock_request")).toBe(PROJECT_COMPLETED_COPY);
    expect(projectWriteRefusal("completed", "daily_update")).toBe(PROJECT_COMPLETED_COPY);
    expect(projectWriteRefusal("completed", "edit")).toBeNull();
  });

  it.each(["planning", "active", "on_hold", null])("allows everything on %s", (status) => {
    for (const kind of ["edit", "stock_request", "daily_update"] as const) {
      expect(projectWriteRefusal(status, kind)).toBeNull();
    }
  });
});

describe("Edit Project validation (APX-11)", () => {
  it("accepts percentages from 0 to 100 with up to 3 decimals", () => {
    for (const v of ["0", "18", "18.000", "2.5", "100", " 5 "]) expect(isValidPercent(v)).toBe(true);
  });

  it("rejects anything else", () => {
    for (const v of ["", "-1", "100.001", "101", "18.0001", "abc", "1e2", "NaN"]) {
      expect(isValidPercent(v)).toBe(false);
    }
  });

  it("refuses a target end date before the start date", () => {
    expect(targetEndDateRefusal("2026-09-01", "2026-08-31")).toBeTruthy();
    expect(targetEndDateRefusal("2026-09-01", "2026-09-01")).toBeNull();
    expect(targetEndDateRefusal("2026-09-01", null)).toBeNull();
  });

  it("refuses an advance below what bills already recovered, exactly", () => {
    expect(mobilisationAdvanceRefusal("99999.99", "100000")).toBeTruthy();
    expect(mobilisationAdvanceRefusal("100000", "100000.00")).toBeNull();
    expect(mobilisationAdvanceRefusal("0", 0)).toBeNull();
  });

  const current = { status: "active", startDate: "2026-09-01", mobilisationRecovered: "500" };

  it("puts each refusal on the field it concerns", () => {
    expect(projectEditRefusal(current, { targetEndDate: "2026-01-01" })?.field).toBe("targetEndDate");
    expect(projectEditRefusal(current, { mobilisationAdvance: "100" })?.field).toBe("mobilisationAdvance");
    expect(projectEditRefusal(current, { targetEndDate: "", mobilisationAdvance: "500" })).toBeNull();
  });

  it("refuses any edit to an archived project", () => {
    expect(projectEditRefusal({ ...current, status: "archived" }, {})).toEqual({
      field: "form",
      message: PROJECT_ARCHIVED_COPY,
    });
  });
});

describe("setupChecklist (APX-70)", () => {
  const ready: SetupFacts = {
    status: "active",
    packages: [{ id: "p1", seqNo: 1, name: "Pool", allocated: 100, phases: 2, tasks: 3 }],
    siteMembers: 1,
    clientMembers: 1,
  };

  it("is in the order the work has to happen", () => {
    expect(setupChecklist(ready).map((i) => i.key)).toEqual([
      "packages",
      "phases",
      "tasks",
      "site",
      "client",
      "active",
    ]);
  });

  it("is all done for a set-up project, and the card hides", () => {
    expect(setupChecklist(ready).every((i) => i.done)).toBe(true);
    expect(showSetupChecklist(ready)).toBe(false);
  });

  it("a brand-new project has nothing done and points at Add Package", () => {
    const fresh: SetupFacts = { status: "planning", packages: [], siteMembers: 0, clientMembers: 0 };
    const items = setupChecklist(fresh);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items[0]?.target).toEqual({ kind: "addPackage" });
    expect(showSetupChecklist(fresh)).toBe(true);
  });

  it("points a package-level item at the first package still missing it", () => {
    const facts: SetupFacts = {
      ...ready,
      packages: [
        { id: "p2", seqNo: 2, name: "Facade", allocated: 0, phases: 0, tasks: 0 },
        { id: "p1", seqNo: 1, name: "Pool", allocated: 100, phases: 1, tasks: 0 },
      ],
    };
    const [budgets, phases, tasks] = setupChecklist(facts);
    expect(budgets?.target).toEqual({ kind: "package", packageId: "p2", tab: "budget" });
    expect(budgets?.detail).toBe("Facade has no budget.");
    expect(phases?.target).toEqual({ kind: "package", packageId: "p2", tab: "budget" });
    expect(tasks?.target).toEqual({ kind: "package", packageId: "p1", tab: "schedule" });
    expect(tasks?.detail).toBe("2 packages have no tasks.");
  });

  it("asks for Active only while the project is Planning", () => {
    expect(setupChecklist({ ...ready, status: "planning" }).at(-1)?.done).toBe(false);
    expect(setupChecklist({ ...ready, status: "on_hold" }).at(-1)?.done).toBe(true);
  });

  it("never shows on a finished project", () => {
    const gaps: SetupFacts = { ...ready, siteMembers: 0 };
    expect(showSetupChecklist({ ...gaps, status: "completed" })).toBe(false);
    expect(showSetupChecklist({ ...gaps, status: "archived" })).toBe(false);
    expect(showSetupChecklist(gaps)).toBe(true);
  });
});
