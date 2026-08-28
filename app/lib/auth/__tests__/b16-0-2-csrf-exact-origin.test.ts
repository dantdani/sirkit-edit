/**
 * B16.0.2 §C — EXACT-origin CSRF against the ONE server-owned expected origin.
 *
 * R4 closure: both independently reproduced bypasses are pinned as negative
 * tripwires (scheme downgrade on the same host; X-Forwarded-Host spoofing),
 * plus missing / null / malformed / credential-bearing origins, port
 * mismatch, forwarding-header immunity, production fail-closed configuration,
 * and the ordering guarantee (CSRF before ANY body byte is consumed).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requireSameOrigin } from "../request-security";
import { normalizeOrigin, parseOriginHeader, resolveExpectedOrigin, FORBIDDEN_ORIGIN_AUTHORITY_HEADERS } from "../expected-origin";
import { authorizeRequest, scopedTrustedJson } from "../authorize";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "../test-support";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PRODUCTION_BASE = {
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
} as const;
const PRODUCTION = { ...PRODUCTION_BASE, SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" } as const;
const LOCAL_DEV = { SIRKIT_AUTH_MODE: "local_dev" } as const;

function post(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers });
}

async function code(response: Response | null): Promise<string | null> {
  if (!response) return null;
  return ((await response.json()) as { code: string }).code;
}

describe("B16.0.2 §C — the two reproduced bypasses are closed (negative tripwires)", () => {
  it("R4a: https request URL + http Origin on the SAME host is REFUSED (scheme downgrade)", async () => {
    const response = requireSameOrigin(post("https://sirkit.example/api/x", { origin: "http://sirkit.example", host: "sirkit.example" }), PRODUCTION);
    expect(response?.status).toBe(403);
    expect(await code(response)).toBe("AUTH_CROSS_ORIGIN_DENIED");
    // and in local_dev (request-URL expected origin) the same downgrade is refused
    const local = requireSameOrigin(post("https://sirkit.example/api/x", { origin: "http://sirkit.example", host: "sirkit.example" }), LOCAL_DEV);
    expect(await code(local)).toBe("AUTH_CROSS_ORIGIN_DENIED");
  });

  it("R4b: Origin https://evil.example + X-Forwarded-Host evil.example on sirkit.example is REFUSED (forwarding spoof)", async () => {
    const response = requireSameOrigin(
      post("https://sirkit.example/api/x", { origin: "https://evil.example", host: "sirkit.example", "x-forwarded-host": "evil.example" }),
      PRODUCTION,
    );
    expect(await code(response)).toBe("AUTH_CROSS_ORIGIN_DENIED");
    const local = requireSameOrigin(
      post("https://sirkit.example/api/x", { origin: "https://evil.example", host: "sirkit.example", "x-forwarded-host": "evil.example" }),
      LOCAL_DEV,
    );
    expect(await code(local)).toBe("AUTH_CROSS_ORIGIN_DENIED");
  });

  it("NO forwarding or host header can redefine the expected origin (every known header, both modes)", async () => {
    for (const header of FORBIDDEN_ORIGIN_AUTHORITY_HEADERS) {
      for (const env of [PRODUCTION, LOCAL_DEV]) {
        const spoof = requireSameOrigin(post("https://sirkit.example/api/x", { origin: "https://evil.example", [header]: "evil.example", host: "sirkit.example" }), env);
        expect(await code(spoof), `${header} (${env === PRODUCTION ? "production" : "local_dev"})`).toBe("AUTH_CROSS_ORIGIN_DENIED");
      }
    }
    // Even a matching Host with a foreign forwarded proto cannot downgrade.
    expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", { origin: "http://sirkit.example", "x-forwarded-proto": "http" }), PRODUCTION))).toBe("AUTH_CROSS_ORIGIN_DENIED");
  });

  it("the expected-origin module reads NO host/forwarding header (source-pinned)", () => {
    const root = process.cwd();
    const sources = [
      readFileSync(join(root, "app", "lib", "auth", "expected-origin.ts"), "utf8"),
      readFileSync(join(root, "app", "lib", "auth", "request-security.ts"), "utf8"),
    ].join("\n");
    for (const header of [...FORBIDDEN_ORIGIN_AUTHORITY_HEADERS, "host"]) {
      expect(sources.includes(`headers.get("${header}")`), header).toBe(false);
    }
    // Only the Origin header is ever consulted.
    expect(sources.includes('headers.get("origin")')).toBe(true);
  });
});

describe("B16.0.2 §C — the complete normalized origin is compared", () => {
  it("accepts the exact same origin (scheme + host + effective port)", () => {
    expect(requireSameOrigin(post("https://sirkit.example/api/x", { origin: "https://sirkit.example" }), PRODUCTION)).toBeNull();
    // default port elision is canonical on both sides
    expect(requireSameOrigin(post("https://sirkit.example:443/api/x", { origin: "https://sirkit.example" }), { ...PRODUCTION_BASE, SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example:443" })).toBeNull();
    // local_dev: request URL origin (port included)
    expect(requireSameOrigin(post("http://localhost:3000/api/x", { origin: "http://localhost:3000" }), LOCAL_DEV)).toBeNull();
  });

  it("refuses a port mismatch, a sibling host, a superstring host, and a subdomain", async () => {
    for (const origin of ["https://sirkit.example:8443", "https://api.sirkit.example", "https://sirkit.example.evil", "https://evilsirkit.example"]) {
      expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", { origin }), PRODUCTION)), origin).toBe("AUTH_CROSS_ORIGIN_DENIED");
    }
    expect(await code(requireSameOrigin(post("http://localhost:3000/api/x", { origin: "http://localhost:3001" }), LOCAL_DEV))).toBe("AUTH_CROSS_ORIGIN_DENIED");
  });

  it("refuses missing, null, malformed, credential-bearing, path-carrying and non-http origins", async () => {
    expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", {}), PRODUCTION))).toBe("AUTH_ORIGIN_MISSING");
    expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", { origin: "null" }), PRODUCTION))).toBe("AUTH_ORIGIN_NULL");
    for (const origin of ["not a url", "https://user:pw@sirkit.example", "https://sirkit.example/path", "https://sirkit.example/?q=1", "ftp://sirkit.example", "https://sirkit.example/", "HTTPS://SIRKIT.EXAMPLE", "https://sirkit.example:443"]) {
      expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", { origin }), PRODUCTION)), origin).toBe("AUTH_ORIGIN_MALFORMED");
    }
  });

  it("safe methods are exempt", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(requireSameOrigin(new Request("https://sirkit.example/api/x", { method }), PRODUCTION)).toBeNull();
    }
  });

  it("normalizeOrigin: strict (header) vs lenient (configuration) canonicalization", () => {
    expect(normalizeOrigin("https://Sirkit.Example/")).toBe("https://sirkit.example");
    expect(normalizeOrigin("https://sirkit.example:443")).toBe("https://sirkit.example");
    expect(normalizeOrigin("https://sirkit.example", { strict: true })).toBe("https://sirkit.example");
    expect(normalizeOrigin("https://sirkit.example/", { strict: true })).toBeNull();
    expect(normalizeOrigin("https://u:p@sirkit.example")).toBeNull();
    expect(normalizeOrigin("https://sirkit.example/a")).toBeNull();
    expect(normalizeOrigin("")).toBeNull();
    expect(parseOriginHeader(new Request("https://x/", { headers: { origin: "https://sirkit.example" } }))).toEqual({ ok: true, origin: "https://sirkit.example" });
  });
});

describe("B16.0.2 §C — the expected origin is server-owned and fails closed", () => {
  it("production WITHOUT SIRKIT_EXPECTED_ORIGIN refuses every state-changing request (fail closed)", async () => {
    const resolved = resolveExpectedOrigin(post("https://sirkit.example/api/x", { origin: "https://sirkit.example" }), PRODUCTION_BASE);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.code).toBe("AUTH_ORIGIN_NOT_CONFIGURED");
    // even a perfectly matching Origin is refused until configured
    expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", { origin: "https://sirkit.example" }), PRODUCTION_BASE))).toBe("AUTH_ORIGIN_NOT_CONFIGURED");
  });

  it("production with MALFORMED configuration fails closed (and http is refused for a non-loopback host)", async () => {
    for (const bad of ["sirkit.example", "https://u:p@sirkit.example", "https://sirkit.example/app", "http://sirkit.example", "https://a.example, https://b.example"]) {
      expect(await code(requireSameOrigin(post("https://sirkit.example/api/x", { origin: "https://sirkit.example" }), { ...PRODUCTION_BASE, SIRKIT_EXPECTED_ORIGIN: bad })), bad).toBe("AUTH_ORIGIN_CONFIG_MALFORMED");
    }
    // http is permitted ONLY for loopback in production
    expect(requireSameOrigin(post("http://localhost:3000/api/x", { origin: "http://localhost:3000" }), { ...PRODUCTION_BASE, SIRKIT_EXPECTED_ORIGIN: "http://localhost:3000" })).toBeNull();
  });

  it("the configured origin wins over the request URL in EVERY mode (a proxy-rewritten URL cannot widen it)", async () => {
    const env = { ...LOCAL_DEV, SIRKIT_EXPECTED_ORIGIN: "http://localhost:3000" };
    expect(await code(requireSameOrigin(post("http://evil.example/api/x", { origin: "http://evil.example" }), env))).toBe("AUTH_CROSS_ORIGIN_DENIED");
    expect(requireSameOrigin(post("http://evil.example/api/x", { origin: "http://localhost:3000" }), env)).toBeNull();
    const resolved = resolveExpectedOrigin(post("http://evil.example/api/x", {}), env);
    expect(resolved).toEqual({ ok: true, origin: "http://localhost:3000", source: "configured" });
  });

  it("local development uses the request URL origin ONLY when nothing is configured (source = request-url-local-dev)", () => {
    const resolved = resolveExpectedOrigin(post("http://localhost:3000/api/x", { "x-forwarded-host": "evil.example" }), LOCAL_DEV);
    expect(resolved).toEqual({ ok: true, origin: "http://localhost:3000", source: "request-url-local-dev" });
  });
});

describe("B16.0.2 §C — CSRF runs BEFORE body consumption and before identity/membership at the real boundary", () => {
  const SEL = { "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", "content-type": "application/json" };
  beforeEach(() => { injectAuthorizedPrincipal({ userId: "admin-1", tenantId: "tenant-1", projectId: "project-1", role: "admin" }); });
  afterEach(() => { resetInjectedIdentity(); });

  it("a cross-origin authenticated POST never pulls a single body byte (scopedTrustedJson)", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) { pulled += 1; controller.enqueue(new TextEncoder().encode("{}")); controller.close(); } }, { highWaterMark: 0 });
    const request = new Request("https://sirkit.example/api/calculation/problem", { method: "POST", headers: { ...SEL, origin: "https://evil.example" }, body, duplex: "half" } as RequestInit);
    const outcome = await scopedTrustedJson(request, { maxBytes: 1000, environment: PRODUCTION });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.response.status).toBe(403);
    expect(pulled).toBe(0);
  });

  it("authorizeRequest: production admin + exact origin passes; downgrade / spoof / unconfigured refuse 403", async () => {
    const good = await authorizeRequest(new Request("https://sirkit.example/api/pcb/release", { method: "POST", headers: { ...SEL, origin: "https://sirkit.example" } }), { environment: PRODUCTION });
    expect(good.ok).toBe(true);
    const downgrade = await authorizeRequest(new Request("https://sirkit.example/api/pcb/release", { method: "POST", headers: { ...SEL, origin: "http://sirkit.example" } }), { environment: PRODUCTION });
    expect(!downgrade.ok && downgrade.response.status).toBe(403);
    const spoof = await authorizeRequest(new Request("https://sirkit.example/api/pcb/release", { method: "POST", headers: { ...SEL, origin: "https://evil.example", "x-forwarded-host": "evil.example" } }), { environment: PRODUCTION });
    expect(!spoof.ok && spoof.response.status).toBe(403);
    const unconfigured = await authorizeRequest(new Request("https://sirkit.example/api/pcb/release", { method: "POST", headers: { ...SEL, origin: "https://sirkit.example" } }), { environment: PRODUCTION_BASE });
    expect(!unconfigured.ok && unconfigured.response.status).toBe(403);
    if (!unconfigured.ok) expect(await code(unconfigured.response)).toBe("AUTH_ORIGIN_NOT_CONFIGURED");
  });

  it("the public auth boundary (sign-in / sign-out policy rows) applies the SAME exact-origin rule", async () => {
    const spoof = await authorizeRequest(new Request("https://sirkit.example/api/auth/signin", { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example" } }), { environment: PRODUCTION });
    expect(!spoof.ok && spoof.response.status).toBe(403);
    const good = await authorizeRequest(new Request("https://sirkit.example/api/auth/signout", { method: "POST", headers: { origin: "https://sirkit.example" } }), { environment: PRODUCTION });
    expect(good.ok).toBe(true);
  });
});
