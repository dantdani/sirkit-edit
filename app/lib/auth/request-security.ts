/**
 * B16.0 — request security for cookie-authenticated, state-changing routes.
 *
 * Next.js Route Handlers get NO automatic CSRF protection (the Origin/Host
 * check is a Server-Action feature), so cookie-authenticated mutations must
 * validate same-origin themselves. This module provides:
 *  - EXACT same-origin validation against the server-owned expected origin
 *    ([B16.0.2 §C] scheme + hostname + effective port; forwarding headers
 *    can never redefine it),
 *  - unsupported-content-type rejection,
 *  - open-redirect prevention,
 *  - bounded, secret-free public diagnostics,
 *  - a 401 (authentication) vs 403 (authorization) distinction.
 *
 * Tokens are never placed in URLs, logs, or error messages.
 */

import { parseOriginHeader, resolveExpectedOrigin } from "./expected-origin";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonError(status: number, code: string, message: string): Response {
  // Bounded public diagnostic — never a secret, token, or raw stack.
  return Response.json({ ok: false, code, error: message.slice(0, 300) }, { status, headers: NO_STORE });
}

/** 401 — the caller is not authenticated (who are you?). */
export function unauthenticated(code = "AUTH_UNAUTHENTICATED", message = "Authentication is required."): Response {
  return jsonError(401, code, message);
}

/** 403 — the caller is authenticated but not authorized here. */
export function forbidden(code = "AUTH_FORBIDDEN", message = "You are not authorized for this project operation."): Response {
  return jsonError(403, code, message);
}

/**
 * [B16.0.2 §C] EXACT same-origin validation for a cookie-authenticated
 * state-changing request.
 *
 * Compares the COMPLETE normalized `Origin` header (scheme + hostname +
 * effective port) against the ONE server-owned expected origin
 * (`resolveExpectedOrigin`: the validated `SIRKIT_EXPECTED_ORIGIN`
 * configuration, or — outside production only — the request URL's origin).
 * `Host`, `X-Forwarded-Host`, `Forwarded` and similar caller-controlled
 * headers are NEVER consulted. Missing / null / malformed / credential-
 * bearing origins, scheme downgrade, port mismatch, and forwarding-header
 * spoofing are all refused; missing or malformed production configuration
 * fails closed. Safe methods (GET/HEAD/OPTIONS) are exempt. Returns null
 * when OK, or a 403 response.
 */
export function requireSameOrigin(request: Request, environment: Record<string, string | undefined> = process.env): Response | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const expected = resolveExpectedOrigin(request, environment);
  if (!expected.ok) return forbidden(expected.code, expected.message);
  const presented = parseOriginHeader(request);
  if (!presented.ok) return forbidden(presented.code, presented.message);
  if (presented.origin !== expected.origin) {
    return forbidden("AUTH_CROSS_ORIGIN_DENIED", "Cross-origin state-changing requests are refused.");
  }
  return null;
}

/** Reject an unsupported content type. Returns null when OK. */
export function requireJsonContentType(request: Request): Response | null {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "application/json") {
    return jsonError(415, "AUTH_MEDIA_TYPE_UNSUPPORTED", "Content-Type must be application/json.");
  }
  return null;
}

/** Validate a redirect target is a same-origin relative path (open-redirect
 *  prevention). Returns the safe path, or null when the target is unsafe. */
export function safeRedirectPath(target: string | null | undefined, fallback = "/"): string {
  if (typeof target !== "string" || target.length === 0) return fallback;
  // Only accept a single-leading-slash relative path (not `//host` protocol-
  // relative, not an absolute URL, not a backslash trick).
  if (!target.startsWith("/") || target.startsWith("//") || target.startsWith("/\\") || target.includes("\\")) return fallback;
  try {
    // Resolve against a dummy origin; reject if it escapes the path space.
    const url = new URL(target, "http://localhost");
    if (url.origin !== "http://localhost") return fallback;
    return url.pathname + url.search;
  } catch {
    return fallback;
  }
}
