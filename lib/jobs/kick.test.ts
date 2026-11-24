import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** APX-20: the post-enqueue drain kick is fire-and-forget and cannot fail the action. */

const h = vi.hoisted(() => ({
  siteUrl: "https://apex.example.com" as string | undefined,
  after: vi.fn<(cb: () => unknown) => void>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: h.after }));
vi.mock("@/lib/env", () => ({ env: { CRON_SECRET: "s".repeat(44) } }));
vi.mock("@/lib/env.client", () => ({
  clientEnv: {
    get NEXT_PUBLIC_SITE_URL() {
      return h.siteUrl;
    },
  },
}));

const { callDrain, drainUrl, kickDrain } = await import("./kick");

beforeEach(() => {
  h.siteUrl = "https://apex.example.com";
  h.after.mockReset();
  vi.stubEnv("NODE_ENV", "production");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("drainUrl", () => {
  it("is the drain route on the public origin in production", () => {
    expect(drainUrl()).toBe("https://apex.example.com/api/cron/jobs.drain");
  });

  it("is null outside production, so a dev server never drains the live queue", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(drainUrl()).toBeNull();
  });

  it.each([undefined, "http://localhost:3000", "http://127.0.0.1:3000", "not a url"])(
    "is null for %s",
    (url) => {
      h.siteUrl = url;
      expect(drainUrl()).toBeNull();
    }
  );
});

describe("callDrain", () => {
  it("calls the drain with the cron bearer secret", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    await callDrain(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://apex.example.com/api/cron/jobs.drain");
    expect(init?.headers).toEqual({ Authorization: `Bearer ${"s".repeat(44)}` });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("logs a non-2xx answer and resolves", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("no", { status: 401 }));
    await expect(callDrain(fetchImpl)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
  });

  it("swallows a network error or timeout", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error("timeout");
    });
    await expect(callDrain(fetchImpl)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("does not call anything when there is no safe URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const fetchImpl = vi.fn<typeof fetch>();
    await callDrain(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("kickDrain", () => {
  it("schedules the call for after the response and returns at once", () => {
    kickDrain();
    expect(h.after).toHaveBeenCalledTimes(1);
  });

  it("never throws, even outside a request scope", () => {
    h.after.mockImplementation(() => {
      throw new Error("after() called outside a request scope");
    });
    expect(() => kickDrain()).not.toThrow();
  });
});
