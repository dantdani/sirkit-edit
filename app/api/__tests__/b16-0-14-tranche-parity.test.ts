/**
 * B16.0.14 §A — PERMANENT behavioral pins for the tranche-7 closure of the two
 * routes deferred from B16.0.13:
 *   POST /api/pcb/apply-authorization  (selector-envelope authorization)
 *   POST /api/pcb/assign/suggest       (provider loop + internal footprint search)
 *
 * Written and run GREEN against the PRE-migration raw handlers, then kept green
 * unchanged after the migration to `selectorEnvelopeJsonRoute` /
 * `authenticatedJsonRoute` + the shared footprint-search service.
 *
 * No live provider, embedding, database, or network: `llmRouter.generate` is a
 * fake; the internal footprint search is exercised through a fake `fetch`
 * (pre-migration) / the mocked shared service (post-migration); membership and
 * identity come from the injection seams.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity,
} from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);

// Post-migration, assign/suggest's internal search is a DIRECT call to the
// shared Request-free service (no HTTP fetch). The provider-loop pins drive
// hits through this seam; the real algorithm's parity is covered by the
// dedicated service suite + the unchanged B16.0.12 public-route suite.
vi.mock("@/app/lib/pcb/footprint-search-service", () => ({ searchFootprints: vi.fn() }));
import { searchFootprints } from "@/app/lib/pcb/footprint-search-service";
const searchSvc = vi.mocked(searchFootprints);

import { POST as applyAuth } from "../pcb/apply-authorization/route";
import { POST as suggest } from "../pcb/assign/suggest/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function reqAt(url: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
const applyReq = (body: string, h: Record<string, string> = {}): Request => reqAt("http://localhost/api/pcb/apply-authorization", body, h);
const suggestReq = (body: string, h: Record<string, string> = {}): Request => reqAt("http://localhost/api/pcb/assign/suggest", body, h);
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }

function authed(role: "viewer" | "editor" | "admin" = "editor"): void {
  injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: role as never });
}
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
/** A body stream whose pulls are counted, to prove CSRF refuses before any body read. */
function countingReq(url: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode('{"scope":{}}')); c.close(); } }, { highWaterMark: 0 });
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}

afterEach(() => { resetInjectedIdentity(); generate.mockReset(); searchSvc.mockReset(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// ══════════════════════════════════════════════════════════════════════════
// APPLY-AUTHORIZATION — selector-envelope authorization snapshot
// ══════════════════════════════════════════════════════════════════════════
describe("B16.0.14 §A/§E — apply-authorization selector-envelope parity", () => {
  it("production cross-origin → CSRF refusal BEFORE any body pull (zero bytes read)", async () => {
    stubProduction(); authed();
    const counter = { pulls: 0 };
    const res = await applyAuth(countingReq("http://localhost/api/pcb/apply-authorization", { origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
  });

  it("media behavior (RECORDED): text/plain is HISTORICALLY REJECTED — 415 with the legacy code `body-unsupported-media-type`, no-store", async () => {
    authed();
    const res = await applyAuth(applyReq(JSON.stringify({ scope: { tenantId: "local", projectId: "proj-1", branchId: "main" } }), { "content-type": "text/plain" }));
    // Determined empirically against the raw handler: the route's own bounded
    // reader defaults requireJsonContentType=true, so text/plain never reaches
    // the selector. The wrapper MUST preserve this exact legacy code (not the
    // generic AUTH_MEDIA_TYPE_UNSUPPORTED).
    expect(res.status).toBe(415);
    expect((await payload(res)).code).toBe("body-unsupported-media-type");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("over-limit selector body → 413 payload-too-large, no-store", async () => {
    authed();
    const res = await applyAuth(applyReq("x".repeat(64_001)));
    expect(res.status).toBe(413);
    expect((await payload(res)).code).toBe("payload-too-large");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("malformed JSON → invalid-json, no-store", async () => {
    authed();
    const res = await applyAuth(applyReq("{not json"));
    expect((await payload(res)).code).toBe("invalid-json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("missing scope → scope-required (400); non-string scope fields → scope-malformed (400)", async () => {
    authed();
    const missing = await applyAuth(applyReq(JSON.stringify({ nope: 1 })));
    expect(missing.status).toBe(400);
    expect((await payload(missing)).code).toBe("scope-required");
    const malformed = await applyAuth(applyReq(JSON.stringify({ scope: { tenantId: 1, projectId: "p", branchId: "b" } })));
    expect(malformed.status).toBe(400);
    expect((await payload(malformed)).code).toBe("scope-malformed");
  });

  it("unauthenticated → 401 with NO membership evidence in the body", async () => {
    injectIdentity(null);
    const res = await applyAuth(applyReq(JSON.stringify({ scope: { tenantId: "local", projectId: "proj-1", branchId: "main" } })));
    expect(res.status).toBe(401);
    const text = JSON.stringify(await payload(res));
    expect(text).not.toMatch(/membershipRevision|role|principalId/);
  });

  it("revoked membership → 403; foreign project → 403; neither leaks a role/revision", async () => {
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor", state: "revoked" }]);
    const revoked = await applyAuth(applyReq(JSON.stringify({ scope: { tenantId: "local", projectId: "proj-1", branchId: "main" } })));
    expect(revoked.status).toBe(403);
    expect(JSON.stringify(await payload(revoked))).not.toMatch(/membershipRevision|"role"/);
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor" }]);
    const foreign = await applyAuth(applyReq(JSON.stringify({ scope: { tenantId: "local", projectId: "other-proj", branchId: "main" } })));
    expect(foreign.status).toBe(403);
  });

  it("valid → exact snapshot: server-derived role/principal/revision + TRUSTED scope; body role is ignored", async () => {
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "e1", role: "editor", version: 7 }]);
    // Attacker-supplied authority fields in the body are only a selector — ignored.
    const res = await applyAuth(applyReq(JSON.stringify({
      scope: { tenantId: "local", projectId: "proj-1", branchId: "main" },
      role: "admin", actor: "evil", principalId: "spoof", membershipRevision: 999,
    })));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.ok).toBe(true);
    expect(body.principalId).toBe("e1");
    expect(body.role).toBe("pcb_editor"); // server-derived from membership "editor", NOT body "admin"
    expect((body.scope as Record<string, unknown>)).toEqual({ tenantId: "local", projectId: "proj-1", branchId: "main" });
    expect(body.membershipRevision).not.toBe(999);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ASSIGN/SUGGEST — provider loop + internal footprint search
// ══════════════════════════════════════════════════════════════════════════
const HIT = (id: string, padCount: number, name = id): FootprintHit => ({
  id, libName: "Package_SO", name, fullName: `Package_SO:${name}`, description: null, padCount, attrSmd: true, attrTht: false, bodyBBox: null, score: 0.9,
});
type FootprintHit = { id: string; libName: string; name: string; fullName: string; description: string | null; padCount: number; attrSmd: boolean; attrTht: boolean; bodyBBox: null; score: number };

describe("B16.0.14 §A/§H — assign/suggest provider + search parity (post-migration)", () => {
  it("R-SSRF CLOSURE: even a synthetic attacker ORIGIN performs ZERO fetch — the shared service is called directly with typed inputs", async () => {
    authed();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    searchSvc.mockResolvedValue([] as never);
    generate
      .mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "search_footprints", input: { query: "SOIC-8", padCount: 2 } }] } as never)
      .mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t2", name: "submit_candidates", input: { candidates: [] } }] } as never);
    const res = await suggest(reqAt("http://synthetic-attacker.example/api/pcb/assign/suggest",
      JSON.stringify({ component: { id: "c1", ref: "U1", pins: [{ number: "1" }, { number: "2" }] } }),
      { origin: "http://synthetic-attacker.example" }));
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();               // no HTTP hop at all
    expect(searchSvc).toHaveBeenCalledTimes(1);
    // typed, already-bounded values — no URL/origin/host anywhere.
    expect(searchSvc.mock.calls[0]![0]).toEqual({ q: "SOIC-8", limit: 10, padCount: 2, smd: null });
  });

  it("anonymous → 401, ZERO provider calls, ZERO search", async () => {
    injectIdentity(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await suggest(suggestReq(JSON.stringify({ component: { id: "c1", ref: "U1", pins: [{ number: "1" }] } })));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
    expect(searchSvc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("invalid component → 400, ZERO provider calls, ZERO search", async () => {
    authed();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await suggest(suggestReq(JSON.stringify({ component: { id: "c1" } })));
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe("component with id, ref and pins[] is required");
    expect(generate).not.toHaveBeenCalled();
    expect(searchSvc).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("full loop: search then submit — pad-count enforced, hallucinated ids dropped, confidence clamped, ≤3 candidates; search limit 10", async () => {
    authed();
    vi.stubGlobal("fetch", vi.fn());
    searchSvc.mockResolvedValue([HIT("f-good", 2, "SOIC-8"), HIT("f-wrongpads", 14, "SOIC-14")] as never);
    generate
      .mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "search_footprints", input: { query: "SOIC-8", padCount: 2 } }] } as never)
      .mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t2", name: "submit_candidates", input: { candidates: [
        { footprintId: "f-good", confidence: 2.5, reason: "exact package match" },   // confidence clamps to 1
        { footprintId: "f-wrongpads", confidence: 0.8, reason: "wrong pads" },        // dropped: padCount != 2
        { footprintId: "f-hallucinated", confidence: 0.7, reason: "never surfaced" }, // dropped: not surfaced
      ] } }] } as never);
    const res = await suggest(suggestReq(JSON.stringify({ component: { id: "c1", ref: "U1", package: "SOIC-8", pins: [{ number: "1" }, { number: "2" }] } })));
    expect(res.status).toBe(200);
    const cands = (await payload(res)).candidates as Array<{ footprintId: string; confidence: number }>;
    expect(cands.length).toBe(1);
    expect(cands[0]!.footprintId).toBe("f-good");
    expect(cands[0]!.confidence).toBe(1);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(searchSvc.mock.calls[0]![0]).toEqual({ q: "SOIC-8", limit: 10, padCount: 2, smd: null });
  });

  it("search limit is 3: a 4th search_footprints call is refused in-band without hitting the service", async () => {
    authed();
    vi.stubGlobal("fetch", vi.fn());
    searchSvc.mockResolvedValue([] as never);
    const searchTurn = { provider: "openai", model: "m", text: "", toolCalls: [{ id: "s", name: "search_footprints", input: { query: "x", padCount: 1 } }] };
    generate
      .mockResolvedValueOnce(searchTurn as never)
      .mockResolvedValueOnce(searchTurn as never)
      .mockResolvedValueOnce(searchTurn as never)
      .mockResolvedValueOnce(searchTurn as never) // 4th → over the MAX_SEARCHES=3 limit
      .mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "sub", name: "submit_candidates", input: { candidates: [] } }] } as never);
    const res = await suggest(suggestReq(JSON.stringify({ component: { id: "c1", ref: "U1", pins: [{ number: "1" }] } })));
    expect(res.status).toBe(200);
    expect(searchSvc).toHaveBeenCalledTimes(3); // 4th refused in-band
  });

  it("provider failure → normalized providerErrorResponse (503)", async () => {
    authed();
    vi.stubGlobal("fetch", vi.fn());
    generate.mockRejectedValue(new Error("boom"));
    const res = await suggest(suggestReq(JSON.stringify({ component: { id: "c1", ref: "U1", pins: [{ number: "1" }] } })));
    expect(res.status).toBe(503);
  });
});
