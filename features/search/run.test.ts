import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

/**
 * searchFor — the shared runner for the web header and the mobile API: the
 * per-user rate limit first (20 a minute, `rpc_check_rate_limit`), then the
 * role-scoped search with the caller's own session. The search itself is
 * ./queries.test.ts.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  searchAll: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: h.rpc }) }));
vi.mock("./queries", () => ({ searchAll: h.searchAll }));

const { searchFor } = await import("./run");

const SESSION: Session = {
  userId: "00000000-0000-4000-8000-0000000000d5",
  orgId: "00000000-0000-4000-8000-0000000000a0",
  role: "site",
  fullName: "Test User",
  email: null,
  impersonating: null,
};

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: true, error: null });
  h.searchAll.mockReset();
  h.searchAll.mockResolvedValue([]);
});

describe("searchFor", () => {
  it("checks the rate limit, then searches with the caller's session", async () => {
    await searchFor(SESSION, "tile");

    expect(h.rpc).toHaveBeenCalledExactlyOnceWith("rpc_check_rate_limit", {
      p_action: "search",
      p_max_per_window: 20,
      p_window_seconds: 60,
    });
    expect(h.searchAll).toHaveBeenCalledExactlyOnceWith(SESSION, "tile");
  });

  it("refuses once the limit is reached, without searching", async () => {
    h.rpc.mockResolvedValue({ data: false, error: null });

    await expect(searchFor(SESSION, "tile")).rejects.toThrow("RATE_LIMITED: too many searches, slow down");
    expect(h.searchAll).not.toHaveBeenCalled();
  });

  it("throws the rate-limit check's own error unchanged", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "rate limit lookup failed" } });

    await expect(searchFor(SESSION, "tile")).rejects.toThrow("rate limit lookup failed");
    expect(h.searchAll).not.toHaveBeenCalled();
  });
});
