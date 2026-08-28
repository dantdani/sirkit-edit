/**
 * B16.0.14 §D/§J — permanent runtime + structural proofs for the selector-
 * envelope wrapper and the tranche-7 closure. No live provider/embedding/DB.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  injectIdentity, injectMembership, injectAuthorizedPrincipal, resetInjectedIdentity,
} from "@/app/lib/auth/test-support";
import { selectorEnvelopeJsonRoute } from "@/app/lib/auth/route-handlers";
import { classifyRouteMethodForm, APPROVED_ROUTE_WRAPPERS } from "./_boundary-analysis";

const ROOT = process.cwd();
/** Source with comments stripped — structural gates must inspect CODE, not the
 *  prose that describes what the code deliberately forbids. */
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); });

// A test route bound to the apply-authorization policy path so the wrapper's
// exact policy/CSRF/role behavior is exercised through a real policy row.
const PATH = "/api/pcb/apply-authorization";
let seen: unknown = "UNSET";
const testRoute = selectorEnvelopeJsonRoute({ maxBytes: 64_000, deadlineMs: 10_000 }, async (input) => {
  seen = input;
  return Response.json({ ok: true, role: input.context.actor.role, principalId: input.context.principalId });
});
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function req(body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
function counting(headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode('{"scope":{}}')); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}
const scopeBody = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ scope: { tenantId: "local", projectId: "proj-1", branchId: "main" }, ...extra });
function production(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}

describe("B16.0.14 §D — selector-envelope wrapper runtime proofs", () => {
  it("cross-origin CSRF refusal pulls ZERO bytes and never resolves identity", async () => {
    production();
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const counter = { pulls: 0 };
    const res = await testRoute(counting({ origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
  });

  it("a malformed selector body cannot invoke identity/membership resolution (scope-malformed before auth)", async () => {
    // No identity injected — if the wrapper tried to resolve identity it would
    // 401; instead the structural selector check refuses first.
    const res = await testRoute(req(JSON.stringify({ scope: { tenantId: 1, projectId: "p", branchId: "b" } })));
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe("scope-malformed");
  });

  it("missing scope → scope-required (400)", async () => {
    const res = await testRoute(req(JSON.stringify({ nope: 1 })));
    expect((await res.json() as { code: string }).code).toBe("scope-required");
  });

  it("oversized body settles once → payload-too-large (413); malformed → invalid-json", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const big = await testRoute(req("x".repeat(64_001)));
    expect(big.status).toBe(413);
    expect((await big.json() as { code: string }).code).toBe("payload-too-large");
    const bad = await testRoute(req("{not json"));
    expect((await bad.json() as { code: string }).code).toBe("invalid-json");
  });

  it("valid selector + NO identity → 401 (identity resolution happens after selector)", async () => {
    injectIdentity(null);
    const res = await testRoute(req(scopeBody()));
    expect(res.status).toBe(401);
  });

  it("valid identity + missing/revoked/foreign membership → 403", async () => {
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor", state: "revoked" }]);
    expect((await testRoute(req(scopeBody()))).status).toBe(403);
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor" }]);
    expect((await testRoute(req(JSON.stringify({ scope: { tenantId: "local", projectId: "foreign", branchId: "main" } })))).status).toBe(403);
  });

  it("permitted role succeeds; selector body role/actor NEVER determine the resolved role", async () => {
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor" }]);
    const res = await testRoute(req(scopeBody({ role: "admin", actor: "evil", principalId: "spoof" })));
    expect(res.status).toBe(200);
    const body = await res.json() as { role: string; principalId: string };
    expect(body.role).toBe("pcb_editor"); // server-derived from membership, NOT body "admin"
    expect(body.principalId).toBe("e1");
  });

  it("the callback input exposes NO Request-capable value (no request/headers/cookies/url)", async () => {
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor" }]);
    seen = "UNSET";
    await testRoute(req(scopeBody()));
    expect(seen).not.toBe("UNSET");
    const keys = Object.keys(seen as object).sort();
    expect(keys).toEqual(["body", "bytes", "context", "meta"]);
    const serialized = JSON.stringify(seen);
    expect(serialized).not.toMatch(/"headers"|"cookies"|"url"|"signal"/);
  });
});

describe("B16.0.14 §B/§J — sanctioned provenance + structural closure", () => {
  it("selectorEnvelopeJsonRoute is in the approved canonical-wrapper inventory", () => {
    expect(APPROVED_ROUTE_WRAPPERS as readonly string[]).toContain("selectorEnvelopeJsonRoute");
  });

  it("both tranche-7 methods classify as canonical-wrapper by exact provenance", () => {
    for (const [rel, m] of [
      ["app/api/pcb/apply-authorization/route.ts", "POST"],
      ["app/api/pcb/assign/suggest/route.ts", "POST"],
    ] as const) {
      const c = classifyRouteMethodForm(read(rel), m, join(ROOT, rel), ROOT);
      expect(c.form, `${m} ${rel}`).toBe("canonical-wrapper");
    }
  });

  it("apply-authorization has NO raw Request handler and imports the selector-envelope wrapper", () => {
    const src = read("app/api/pcb/apply-authorization/route.ts");
    expect(src).not.toMatch(/export\s+async\s+function\s+POST/);
    expect(src).toMatch(/selectorEnvelopeJsonRoute/);
    expect(src).not.toMatch(/authorizeRequest|readBoundedJson|new URL\(/);
  });

  it("SSRF closure: assign/suggest contains NO fetch and reads NO request url/origin/host", () => {
    const src = read("app/api/pcb/assign/suggest/route.ts");
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/new URL\(|req\.url|request\.url|\.origin\b|x-forwarded-host|["']host["']/i);
    expect(src).toMatch(/searchFootprints\(/);
    expect(src).toMatch(/authenticatedJsonRoute/);
  });

  it("the shared search service is Request-free — it accepts no Request/URL/Headers and constructs no URL", () => {
    const src = read("app/lib/pcb/footprint-search-service.ts");
    expect(src).not.toMatch(/:\s*Request\b|:\s*URL\b|:\s*Headers\b|URLSearchParams|\.origin\b|\bfetch\s*\(|new URL\(/);
    expect(src).toMatch(/export interface FootprintSearchInput/);
    expect(src).toMatch(/export async function searchFootprints/);
  });
});
