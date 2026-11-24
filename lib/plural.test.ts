import { describe, expect, it } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("uses the singular for exactly one", () => {
    expect(plural(1, "package")).toBe("1 package");
  });

  it("uses the plural for zero and for many", () => {
    expect(plural(0, "package")).toBe("0 packages");
    expect(plural(9, "package")).toBe("9 packages");
  });

  it("takes an irregular plural", () => {
    expect(plural(2, "entry", "entries")).toBe("2 entries");
    expect(plural(1, "entry", "entries")).toBe("1 entry");
  });
});
