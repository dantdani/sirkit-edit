/**
 * B16.0.8 §B/§F — unit tests for every NEW wrapper capability: publicRoute,
 * workerRoute, kicadLibraryRoute, dynamic route params, the bounded query
 * projection, the safe-header allowlist (secret headers structurally
 * unavailable), and opt-in AbortSignal. Also proves the declared worker
 * refusal contract and that callbacks receive no Request-capable value.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { publicRoute, publicJsonRoute, workerRoute, workerJsonRoute, kicadLibraryRoute, authenticatedRoute } from "@/app/lib/auth/route-handlers";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
// real PUBLIC policy paths so authorizeRequest resolves a policy row
const PUB_GET = "http://localhost/api/parts/categories";
const PUB_POST = "http://localhost/api/parts/search";
const WORKER_POST = "http://localhost/api/engineering-effects";
const AUTH_GET = "http://localhost/api/footprint-resolution";

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); });

describe("publicRoute", () => {
  it("executes the policy and passes ONLY meta (no Request) to the callback", async () => {
    let keys: string[] = [];
    const handler = publicRoute(undefined, (input) => { keys = Object.keys(input).sort(); return Response.json({ ok: true }); });
    const res = await handler(new Request(PUB_GET));
    expect(res.status).toBe(200);
    expect(keys).toEqual(["meta"]);
  });
  it("query projection is opt-in, bounded, frozen; absent without the flag", async () => {
    let seen: Record<string, string> | undefined;
    const withQuery = publicRoute({ query: true }, ({ meta }) => { seen = meta.query as Record<string, string>; return Response.json({}); });
    await withQuery(new Request(`${PUB_GET}?a=1&b=${"v".repeat(5000)}&a=dup`));
    expect(seen).toBeDefined();
    expect(seen!.a).toBe("1"); // first value wins
    expect(seen!.b.length).toBe(2048); // bounded
    expect(Object.isFrozen(seen)).toBe(true);
    let meta2: Record<string, unknown> = {};
    const noQuery = publicRoute(undefined, ({ meta }) => { meta2 = meta as unknown as Record<string, unknown>; return Response.json({}); });
    await noQuery(new Request(`${PUB_GET}?a=1`));
    expect("query" in meta2).toBe(false);
  });
  it("safe-header projection: only allowlisted names; secret-like names throw at CONSTRUCTION", () => {
    expect(() => publicRoute({ safeHeaders: ["cookie"] }, () => Response.json({}))).toThrow(/never be allowlisted/);
    expect(() => publicRoute({ safeHeaders: ["authorization"] }, () => Response.json({}))).toThrow(/never be allowlisted/);
    expect(() => publicRoute({ safeHeaders: ["x-api-token"] }, () => Response.json({}))).toThrow(/never be allowlisted/);
    expect(() => publicRoute({ safeHeaders: ["x-session-key"] }, () => Response.json({}))).toThrow(/never be allowlisted/);
  });
  it("allowlisted non-secret header is projected; UNDECLARED headers are structurally unavailable", async () => {
    let headers: Record<string, string> | undefined;
    const handler = publicRoute({ safeHeaders: ["x-request-locale"] }, ({ meta }) => { headers = meta.headers as Record<string, string>; return Response.json({}); });
    await handler(new Request(PUB_GET, { headers: { "x-request-locale": "en-GB", "x-undeclared": "hidden", cookie: "session=secret" } }));
    expect(headers).toEqual({ "x-request-locale": "en-GB" });
    expect(Object.isFrozen(headers)).toBe(true);
  });
  it("declared dynamic params: resolved to a bounded plain record; missing/invalid → 400", async () => {
    let params: Record<string, string> | undefined;
    const handler = publicRoute({ routeParams: ["id"] }, (input) => { params = input.params as Record<string, string>; return Response.json({}); });
    const ok = await handler(new Request(PUB_GET), { params: Promise.resolve({ id: "abc" }) });
    expect(ok.status).toBe(200);
    expect(params).toEqual({ id: "abc" });
    const missing = await handler(new Request(PUB_GET), { params: Promise.resolve({}) });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { code: string }).code).toBe("AUTH_ROUTE_PARAM_INVALID");
    const oversized = await handler(new Request(PUB_GET), { params: Promise.resolve({ id: "x".repeat(600) }) });
    expect(oversized.status).toBe(400);
  });
});

describe("workerRoute / workerJsonRoute", () => {
  it("workerRoute: declared unauthorized contract (code + noStore) preserved; principal reaches the callback; no human actor forgeable", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", "s3cr3t");
    let principalId = "";
    let actorKind = "";
    const handler = workerRoute({ unauthorized: { code: "XX_LEGACY_CODE", noStore: true }, exposeAbortSignal: true }, ({ principal, signal }) => {
      principalId = principal.principalId;
      actorKind = principal.actor.actorKind;
      expect(signal).toBeInstanceOf(AbortSignal);
      return Response.json({ ok: true });
    });
    const denied = await handler(new Request(WORKER_POST, { method: "POST" }));
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { code: string }).code).toBe("XX_LEGACY_CODE");
    expect(denied.headers.get("Cache-Control")).toBe("no-store");
    const okRes = await handler(new Request(WORKER_POST, { method: "POST", headers: { authorization: "Bearer s3cr3t" } }));
    expect(okRes.status).toBe(200);
    expect(principalId).toBe("sirkit-workflow-worker");
    expect(actorKind).not.toBe("human"); // the callback cannot receive a human actor
  });
  it("workerJsonRoute: refusal happens BEFORE any body pull; input has no request", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", "s3cr3t");
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
    let keys: string[] = [];
    const handler = workerJsonRoute({ maxBytes: 1000, unauthorized: { code: "XX" } }, (input) => { keys = Object.keys(input).sort(); return Response.json({ ok: true }); });
    const denied = await handler(new Request(WORKER_POST, { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit));
    expect(denied.status).toBe(401);
    expect(pulls).toBe(0);
    const okRes = await handler(new Request(WORKER_POST, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer s3cr3t" }, body: "{}" }));
    expect(okRes.status).toBe(200);
    expect(keys).toEqual(["body", "bytes", "meta", "principal"]);
  });
});

describe("kicadLibraryRoute", () => {
  it("policy + token boundary run inside the wrapper; params declared; callback gets no Request", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "tok");
    let keys: string[] = [];
    const handler = kicadLibraryRoute({ routeParams: ["id"] }, (input) => { keys = Object.keys(input).sort(); return Response.json({ ok: true, id: input.params!.id }); });
    const unauth = await handler(new Request("http://localhost/api/kicad/v1/parts/x"), { params: Promise.resolve({ id: "x" }) });
    expect(unauth.status).toBe(401);
    const okRes = await handler(new Request("http://localhost/api/kicad/v1/parts/x", { headers: { authorization: "Token tok" } }), { params: Promise.resolve({ id: "x" }) });
    expect(okRes.status).toBe(200);
    expect(keys).toEqual(["meta", "params"]);
  });
});

describe("opt-in signal + input isolation on existing wrappers", () => {
  it("authenticatedRoute: signal present only when declared; input never carries request/headers", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" });
    let keys: string[] = [];
    const withSignal = authenticatedRoute({ exposeAbortSignal: true }, (input) => { keys = Object.keys(input).sort(); expect(input.signal).toBeInstanceOf(AbortSignal); return Response.json({}); });
    await withSignal(new Request(AUTH_GET, { headers: { ...SEL } }));
    expect(keys).toEqual(["context", "meta", "signal"]);
    let keys2: string[] = [];
    const without = authenticatedRoute(undefined, (input) => { keys2 = Object.keys(input).sort(); return Response.json({}); });
    await without(new Request(AUTH_GET, { headers: { ...SEL } }));
    expect(keys2).toEqual(["context", "meta"]);
  });
  it("publicJsonRoute with query: true — projection reaches the callback alongside the parsed body", async () => {
    let q: Record<string, string> | undefined;
    const handler = publicJsonRoute({ maxBytes: 1000, query: true }, ({ body, meta }) => { q = meta.query as Record<string, string>; return Response.json({ ok: true, body }); });
    const res = await handler(new Request(`${PUB_POST}?includeGenerics=true`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(res.status).toBe(200);
    expect(q).toEqual({ includeGenerics: "true" });
  });
});
