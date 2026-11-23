/**
 * The response headers every page and route carries (APX-57). Pure and
 * framework-free: next.config.ts imports it by relative path, and the unit
 * test reads the exact policy the build ships.
 *
 * What the app actually loads, and so what the CSP must allow:
 *   - its own scripts, styles and fonts — next/font self-hosts Inter at build
 *     time, so no font CDN. Next.js inlines its bootstrap scripts and the UI
 *     sets inline styles (Recharts, Base UI), hence 'unsafe-inline' for both:
 *     the nonce alternative forces every page dynamic (node_modules/next/dist/
 *     docs/01-app/02-guides/content-security-policy.md, "Without Nonces").
 *     'unsafe-eval' only in development, where React needs it.
 *   - photos from Cloudflare R2 presigned GET URLs (<img>), and uploads by a
 *     presigned PUT from the browser (fetch) — https://*.r2.cloudflarestorage.com.
 *     A download is a navigation, which CSP does not govern.
 *   - blob: previews of a photo before upload (FileUploader), data: images.
 *   - Supabase: the browser client is not used today, but the project URL
 *     (https and its realtime wss) is allowed so adopting it does not break
 *     sign-in silently.
 * frame-ancestors 'none' (with X-Frame-Options for old browsers) stops the
 * Certify and Approve screens being framed for clickjacking.
 */
export const R2_ORIGIN = "https://*.r2.cloudflarestorage.com";

function supabaseOrigins(supabaseUrl: string | undefined): string[] {
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      return [url.origin, `wss://${url.host}`];
    } catch {
      // fall through to the wildcard
    }
  }
  return ["https://*.supabase.co", "wss://*.supabase.co"];
}

export function contentSecurityPolicy(opts: { isDev: boolean; supabaseUrl: string | undefined }): string {
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'", ...(opts.isDev ? ["'unsafe-eval'"] : [])]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", R2_ORIGIN]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", R2_ORIGIN, ...supabaseOrigins(opts.supabaseUrl)]],
    ["media-src", ["'self'", "blob:", R2_ORIGIN]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];
  const policy = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (!opts.isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function securityHeaders(opts: {
  isDev: boolean;
  supabaseUrl: string | undefined;
}): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Frame-Options", value: "DENY" },
    // Two years, every subdomain — the site is HTTPS-only on Vercel.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
  ];
}
