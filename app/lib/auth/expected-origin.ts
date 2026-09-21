/**
 * B16.0.2 §C — the ONE server-owned expected-origin authority for CSRF.
 *
 * R4 (B16.0.1 gap): `requireSameOrigin` compared only the HOST of the
 * `Origin` header against the caller-visible `X-Forwarded-Host` / `Host`
 * header. Two independently reproduced bypasses followed:
 *   1. scheme downgrade — `https://sirkit.example` accepted `Origin:
 *      http://sirkit.example`;
 *   2. forwarding-header spoofing — `Origin: https://evil.example` +
 *      `X-Forwarded-Host: evil.example` was accepted on `sirkit.example`.
 *
 * This module closes both: the EXPECTED origin is a server-owned value
 * (never a request header), and the comparison is the COMPLETE normalized
 * origin — scheme, hostname, and effective port.
 *
 *  - Production: `SIRKIT_EXPECTED_ORIGIN` MUST be configured with ONE
 *    validated absolute origin (https, or http only for a loopback host).
 *    Missing or malformed configuration FAILS CLOSED — every protected
 *    non-idempotent request is refused until the deployment is configured.
 *    A deployment proxy therefore declares its public origin explicitly; no
 *    `Host`, `X-Forwarded-Host`, `X-Forwarded-Proto`, or `Forwarded` header
 *    can ever redefine it.
 *  - Local development (non-production runtime): `SIRKIT_EXPECTED_ORIGIN`
 *    is honored when set; otherwise the expected origin is the ORIGIN OF THE
 *    REQUEST URL the router dispatched on (scheme + host + port) — never a
 *    forwarding header. This is truthful because local_dev is not production
 *    authentication.
 *
 * The `Origin` header itself is parsed strictly: missing, `null`, malformed,
 * credential-bearing, path/query/fragment-carrying, or non-http(s) values are
 * refused before any comparison.
 */

import { resolveAuthMode } from "./mode";

export const SIRKIT_EXPECTED_ORIGIN_ENV = "SIRKIT_EXPECTED_ORIGIN";

export type ExpectedOriginResolution =
  | { ok: true; origin: string; source: "configured" | "request-url-local-dev" }
  | { ok: false; code: "AUTH_ORIGIN_NOT_CONFIGURED" | "AUTH_ORIGIN_CONFIG_MALFORMED" | "AUTH_REQUEST_URL_MALFORMED"; message: string };

export type OriginHeaderParse =
  | { ok: true; origin: string }
  | { ok: false; code: "AUTH_ORIGIN_MISSING" | "AUTH_ORIGIN_NULL" | "AUTH_ORIGIN_MALFORMED"; message: string };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLoopbackHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(lower) || lower.endsWith(".localhost");
}

/**
 * Parse + normalize ONE absolute origin string. Returns the canonical
 * serialization (`scheme://host[:port]`, lowercase, default port elided) or
 * null when the value is not a bare http(s) origin: credentials, a path
 * other than "/", a query, a fragment, or a non-http(s) scheme all refuse.
 * `strict` additionally requires the INPUT to already be a canonical
 * serialization (how a browser sends the `Origin` header) — a trailing slash,
 * an explicit default port, or uppercase scheme/host are refused as
 * malformed.
 */
export function normalizeOrigin(value: string, options: { strict?: boolean } = {}): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "") return null;
  if (url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/" ) return null;
  // A bare origin never carries a trailing "/" in canonical form, but `new
  // URL("https://a.example")` reports pathname "/" either way; the lenient
  // (configuration) path accepts an optional trailing slash, the strict
  // (header) path requires the exact canonical serialization.
  const canonical = url.origin;
  if (canonical === "null") return null;
  if (options.strict && trimmed !== canonical) return null;
  if (!options.strict && trimmed !== canonical && trimmed !== `${canonical}/`) {
    // e.g. an explicit default port ("https://a.example:443") — accept for
    // configuration only when it canonicalizes cleanly.
    try { if (new URL(trimmed.replace(/\/$/, "")).origin !== canonical) return null; } catch { return null; }
  }
  return canonical;
}

/** Resolve the server-owned expected origin for this request. */
export function resolveExpectedOrigin(request: Request, environment: Record<string, string | undefined> = process.env): ExpectedOriginResolution {
  const configured = environment[SIRKIT_EXPECTED_ORIGIN_ENV]?.trim();
  const production = resolveAuthMode(environment) === "production";
  if (configured !== undefined && configured.length > 0) {
    const normalized = normalizeOrigin(configured);
    if (!normalized) {
      return { ok: false, code: "AUTH_ORIGIN_CONFIG_MALFORMED", message: `${SIRKIT_EXPECTED_ORIGIN_ENV} is not a single valid absolute http(s) origin; state-changing requests are refused.` };
    }
    if (production && normalized.startsWith("http:") && !isLoopbackHostname(new URL(normalized).hostname)) {
      return { ok: false, code: "AUTH_ORIGIN_CONFIG_MALFORMED", message: `${SIRKIT_EXPECTED_ORIGIN_ENV} must be an https origin in production; state-changing requests are refused.` };
    }
    return { ok: true, origin: normalized, source: "configured" };
  }
  if (production) {
    return { ok: false, code: "AUTH_ORIGIN_NOT_CONFIGURED", message: `${SIRKIT_EXPECTED_ORIGIN_ENV} is not configured; production state-changing requests are refused until the deployment declares its public origin.` };
  }
  // Local development: the origin the router dispatched on (request URL) —
  // never a forwarding header.
  let origin: string | null = null;
  try { origin = normalizeOrigin(new URL(request.url).origin); } catch { origin = null; }
  if (!origin) {
    return { ok: false, code: "AUTH_REQUEST_URL_MALFORMED", message: "The request URL origin could not be determined; state-changing requests are refused." };
  }
  return { ok: true, origin, source: "request-url-local-dev" };
}

/** Strictly parse the request's `Origin` header. */
export function parseOriginHeader(request: Request): OriginHeaderParse {
  const raw = request.headers.get("origin");
  if (raw === null || raw.trim().length === 0) {
    return { ok: false, code: "AUTH_ORIGIN_MISSING", message: "A same-origin Origin header is required for state-changing requests." };
  }
  if (raw.trim() === "null") {
    return { ok: false, code: "AUTH_ORIGIN_NULL", message: "An opaque (null) Origin is refused for state-changing requests." };
  }
  const origin = normalizeOrigin(raw, { strict: true });
  if (!origin) {
    return { ok: false, code: "AUTH_ORIGIN_MALFORMED", message: "The Origin header is malformed." };
  }
  return { ok: true, origin };
}

/** The headers that must NEVER influence the expected origin (gate-pinned). */
export const FORBIDDEN_ORIGIN_AUTHORITY_HEADERS = ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "forwarded", "x-original-host", "x-host"] as const;
