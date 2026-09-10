import { describe, expect, it } from "vitest";
import { REDACTED, redactEvent, redactValue } from "../redact";

describe("money never leaves the process", () => {
  it("redacts every restricted key named in architecture.md §6.4", () => {
    const out = redactValue({
      internal_amount: 500000,
      unit_cost: 42.5,
      rate: 18,
      internal_cost_amount: 1,
      margin_amount: 91371,
      allocated_amount: 283828,
      price: 99,
      taxable_value: 524538,
    }) as Record<string, unknown>;

    for (const key of Object.keys(out)) {
      if (key === "taxable_value") continue;
      expect(out[key], `${key} was not redacted`).toBe(REDACTED);
    }
  });

  it("keeps keys that carry no money", () => {
    const out = redactValue({
      request_id: "abc",
      user_id: "u1",
      role: "admin",
      project_id: "bhel",
      route: "/projects/bhel/billing",
      duration_ms: 120,
    }) as Record<string, unknown>;
    expect(out).toEqual({
      request_id: "abc",
      user_id: "u1",
      role: "admin",
      project_id: "bhel",
      route: "/projects/bhel/billing",
      duration_ms: 120,
    });
  });

  it("reaches into nested objects and arrays", () => {
    const out = redactValue({
      bill: { lines: [{ desc: "Pool tiling", internal_cost_amount: 10 }] },
    }) as { bill: { lines: { desc: string; internal_cost_amount: string }[] } };
    expect(out.bill.lines[0]?.desc).toBe("Pool tiling");
    expect(out.bill.lines[0]?.internal_cost_amount).toBe(REDACTED);
  });

  it("stops at the depth cap rather than following a cycle forever", () => {
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic.self = cyclic;
    expect(() => redactValue(cyclic)).not.toThrow();
  });

  it("leaves primitives alone", () => {
    expect(redactValue("plain")).toBe("plain");
    expect(redactValue(7)).toBe(7);
    expect(redactValue(null)).toBe(null);
    expect(redactValue(undefined)).toBe(undefined);
  });
});

describe("redactEvent", () => {
  it("cleans extra, contexts, tags and breadcrumb data", () => {
    const out = redactEvent({
      extra: { margin_amount: 1 },
      contexts: { bill: { internal_amount: 2 } },
      tags: { rate: "18" },
      breadcrumbs: [
        { message: "created bill", data: { unit_cost: 3, bill_id: "RA-002" } },
        { message: "no data here" },
      ],
    });

    expect(out.extra?.margin_amount).toBe(REDACTED);
    expect((out.contexts?.bill as Record<string, unknown>).internal_amount).toBe(REDACTED);
    expect(out.tags?.rate).toBe(REDACTED);
    expect(out.breadcrumbs?.[0]?.data?.unit_cost).toBe(REDACTED);
    expect(out.breadcrumbs?.[0]?.data?.bill_id).toBe("RA-002");
    expect(out.breadcrumbs?.[1]?.message).toBe("no data here");
  });

  it("reduces user to id and role — no name, no email (§9.1)", () => {
    const out = redactEvent({
      user: { id: "u1", role: "admin", email: "voola@example.com", username: "Voola", ip_address: "1.2.3.4" },
    });
    expect(out.user).toEqual({ id: "u1", role: "admin" });
  });

  it("does not mutate the event it was given", () => {
    const event = { extra: { margin_amount: 1 } };
    redactEvent(event);
    expect(event.extra.margin_amount).toBe(1);
  });

  it("passes an event with nothing to redact straight through", () => {
    expect(redactEvent({})).toEqual({});
  });
});
