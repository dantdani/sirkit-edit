import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hosts allowed to load dev-server resources (HMR, fonts) cross-origin —
  // e.g. opening the dev server from another device on the LAN.
  allowedDevOrigins: ["172.20.20.20"], poweredByHeader: false, // [B24-A2] D24-5, OD-196: no X-Powered-By; allowedDevOrigins is read by the dev server only
  // [B19-D I5c row 02] images may come only from Sirkit itself, data: and blob: URLs — never a remote host a reply or an
  // imported project names. Only the image directive is set; every other resource type keeps its current behaviour. [B24-A2, 2026-10-06] no longer so: securityHeaders (below) adds frame-ancestors 'none' to the same policy and five more headers (OD-196); the image directive is unchanged.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

export default nextConfig;

/**
 * [B24-A2] D24-5, OD-196 - the security headers sent on every path (the one rule above), built from an environment map; headers()
 * hands it process.env. Pure: it reads SIRKIT_EXPECTED_ORIGIN from the map and nothing else - never a request or a forwarding
 * header. Enforced: the image directive B19-D pins, now with frame-ancestors 'none' in the same Content-Security-Policy;
 * X-Frame-Options DENY for browsers that predate frame-ancestors; nosniff; a strict-origin-when-cross-origin referrer; a
 * Permissions-Policy turning off five features the app never asks for. Report-only until the owner accepts an enforced policy
 * (OD-196): default-src, script-src, connect-src, object-src and base-uri, with no report endpoint (that would be a route).
 * Strict-Transport-Security max-age=31536000 (no includeSubDomains, no preload: those are the owner's, LB-13) only when
 * SIRKIT_EXPECTED_ORIGIN normalises to https - the session cookie's Secure rule (session-cookies.ts:30-38). INFERRED: headers()
 * runs when Next loads this file, and `next build` writes its answer into the routes manifest `next start` serves, so HSTS follows
 * the build-time origin. The builder sits here, not in app/lib/deployment/: a relative TypeScript import from this file is unproven
 * under `next dev` and `next build` (task-A2 deliverable 1's fallback), so the file imports nothing at run time and restates
 * normalizeOrigin's rule below; b24-a2-headers pins the two equal over every origin shape it tries.
 */
export function securityHeaders(environment: Readonly<Record<string, string | undefined>>): { key: string; value: string }[] {
  const headers = [
    { key: "Content-Security-Policy", value: "img-src 'self' data: blob:; frame-ancestors 'none'" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'" },
  ];
  if (normalisesToHttps(environment.SIRKIT_EXPECTED_ORIGIN)) headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000" });
  return headers;
}

/** [B24-A2] normalizeOrigin's lenient (configuration) rule, restated (expected-origin.ts:63-85): one bare origin - no credentials,
 *  path, query or fragment - whose scheme is https. */
function normalisesToHttps(value: string | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return false;
  let url: URL;
  try { url = new URL(trimmed); } catch { return false; }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" || url.pathname !== "/") return false;
  const canonical = url.origin;
  if (canonical === "null") return false;
  if (trimmed === canonical || trimmed === `${canonical}/`) return true;
  try { return new URL(trimmed.replace(/\/$/, "")).origin === canonical; } catch { return false; }
}
