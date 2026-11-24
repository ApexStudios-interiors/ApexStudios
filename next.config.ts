import type { NextConfig } from "next";
import { securityHeaders } from "./lib/security/headers";

const nextConfig: NextConfig = {
  // Fail the production build on a type error rather than shipping it.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Enables forbidden() / app/forbidden.tsx (build/03-auth-and-rbac.md §2.11).
    // Off by default in Next 16; without this the call throws but there is no
    // matching special file to catch it, and it falls through to error.tsx.
    authInterrupts: true,
  },
  // APX-57: CSP (frame-ancestors 'none'), HSTS and the usual hardening
  // headers on every response. The policy and why each source is allowed:
  // lib/security/headers.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          isDev: process.env.NODE_ENV === "development",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];
  },
};

export default nextConfig;
