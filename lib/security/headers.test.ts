import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./headers";

const SUPABASE = "https://abcdefgh.supabase.co";

function directive(policy: string, name: string): string[] {
  const found = policy.split("; ").find((d) => d === name || d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

describe("contentSecurityPolicy (APX-57)", () => {
  const prod = contentSecurityPolicy({ isDev: false, supabaseUrl: SUPABASE });

  it("refuses to be framed — the Certify and Approve screens cannot be clickjacked", () => {
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
  });

  it("allows R2 presigned photos and uploads, and blob: previews", () => {
    expect(directive(prod, "img-src")).toEqual(
      expect.arrayContaining(["'self'", "blob:", "data:", "https://*.r2.cloudflarestorage.com"])
    );
    expect(directive(prod, "connect-src")).toContain("https://*.r2.cloudflarestorage.com");
  });

  it("allows this project's Supabase origin over https and wss only", () => {
    const connect = directive(prod, "connect-src");
    expect(connect).toContain(SUPABASE);
    expect(connect).toContain("wss://abcdefgh.supabase.co");
    expect(connect).not.toContain("https://*.supabase.co");
  });

  it("falls back to the Supabase wildcard when the URL is unknown at build time", () => {
    for (const supabaseUrl of [undefined, "not a url"]) {
      expect(directive(contentSecurityPolicy({ isDev: false, supabaseUrl }), "connect-src")).toContain(
        "https://*.supabase.co"
      );
    }
  });

  it("no eval in production; eval in development only, for React's dev tooling", () => {
    expect(directive(prod, "script-src")).not.toContain("'unsafe-eval'");
    expect(prod).toContain("upgrade-insecure-requests");
    const dev = contentSecurityPolicy({ isDev: true, supabaseUrl: SUPABASE });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("blocks plugins and base-tag hijacking, and keeps forms on this site", () => {
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
  });
});

describe("securityHeaders", () => {
  it("ships CSP, frame denial, HSTS and nosniff", () => {
    const byKey = new Map(
      securityHeaders({ isDev: false, supabaseUrl: SUPABASE }).map((h) => [h.key, h.value])
    );
    expect(byKey.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(byKey.get("X-Frame-Options")).toBe("DENY");
    expect(byKey.get("Strict-Transport-Security")).toMatch(/^max-age=\d+; includeSubDomains$/);
    expect(byKey.get("X-Content-Type-Options")).toBe("nosniff");
    expect(byKey.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
