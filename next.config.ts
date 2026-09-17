import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fail the production build on a type error rather than shipping it.
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Enables forbidden() / app/forbidden.tsx (build/03-auth-and-rbac.md §2.11).
    // Off by default in Next 16; without this the call throws but there is no
    // matching special file to catch it, and it falls through to error.tsx.
    authInterrupts: true,
  },
};

export default nextConfig;
