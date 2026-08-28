/**
 * B16.0.20 §A — PERMANENT route-level parity suite for the tranche-13
 * migration of the six CD-10 model-simulation methods (64 MB family). Written
 * and run GREEN against the raw handlers, then kept green unchanged after
 * migration. Pins only pre = post-stable contracts; the §C execute-gate
 * CORRECTION (ai+automation 400→403) is pinned in the separate
 * b16-0-20-execution-authority suite.
 *
 * No provider / subprocess / container / network / DB. Domain compile/
 * authorize/readiness seams are pass-through spies over the REAL functions
 * (overridden only where a specific verdict is needed); the scope override
 * seam injects non-human actors to test the actor gates.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

const scopeOverride = vi.hoisted(() => ({ value: null as null | Record<string, unknown> }));
vi.mock("@/app/api/model-simulation/_scope", async (orig) => {
  const actual = await orig() as { scopedJson: (r: Request) => Promise<{ ok: boolean; scope?: unknown }>; modelSimulationScopeFromContext?: (c: unknown) => unknown };
  return {
    ...actual,
    scopedJson: async (r: Request) => {
      const parsed = await actual.scopedJson(r);
      return parsed.ok && scopeOverride.value ? { ...parsed, scope: scopeOverride.value } : parsed;
    },
    modelSimulationScopeFromContext: (c: unknown) => scopeOverride.value ?? actual.modelSimulationScopeFromContext!(c),
  };
});
const compileProblem = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/model-simulation/problem", async (orig) => {
  const actual = await orig() as { compileSimulationVerificationProblem: (i: unknown) => unknown };
  compileProblem.mockImplementation((i: unknown) => actual.compileSimulationVerificationProblem(i));
  return { ...actual, compileSimulationVerificationProblem: compileProblem };
});
const authorizeExec = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/model-simulation/safe-execution", async (orig) => {
  const actual = await orig() as { authorizeSimulationExecution: (i: unknown) => unknown };
  authorizeExec.mockImplementation((i: unknown) => actual.authorizeSimulationExecution(i));
  return { ...actual, authorizeSimulationExecution: authorizeExec };
});
const readiness = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/model-simulation/readiness", async (orig) => {
  const actual = await orig() as { evaluateSimulationReadiness: (i: unknown) => unknown };
  readiness.mockImplementation((i: unknown) => actual.evaluateSimulationReadiness(i));
  return { ...actual, evaluateSimulationReadiness: readiness };
});

import { POST as denominator } from "../model-simulation/denominator/route";
import { POST as execute } from "../model-simulation/execute/route";
import { POST as measure } from "../model-simulation/measure/route";
import { POST as problem } from "../model-simulation/problem/route";
import { POST as propose } from "../model-simulation/propose/route";
import { POST as readinessRoute } from "../model-simulation/readiness/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function authed(role: "viewer" | "editor" | "admin" = "editor"): void {
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role });
}
function aiScope(role: string): void {
  scopeOverride.value = { tenantId: "local", projectId: "proj-1", branchId: "main", actorId: "agent-1", actorKind: "ai", role, sessionId: "s1" };
}
function production(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
function counting(path: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}

interface RouteCase { name: string; handler: (r: Request) => Promise<Response>; path: string; missing: { status: number; error: string } }
const ROUTES: RouteCase[] = [
  { name: "denominator", handler: denominator, path: "/api/model-simulation/denominator", missing: { status: 400, error: "complete denominator inputs are required" } },
  { name: "execute", handler: execute, path: "/api/model-simulation/execute", missing: { status: 400, error: "provider, pinned environment, lowering manifest, and content digests are required" } },
  { name: "measure", handler: measure, path: "/api/model-simulation/measure", missing: { status: 400, error: "run, authoritative waveform, measurements, assertions, and scope are required" } },
  { name: "problem", handler: problem, path: "/api/model-simulation/problem", missing: { status: 400, error: "CD-8, CD-9, model registry, testbench registry, providers, and obligation IDs are required" } },
  { name: "propose", handler: propose, path: "/api/model-simulation/propose", missing: { status: 400, error: "typed proposal input is required" } },
  { name: "readiness", handler: readinessRoute, path: "/api/model-simulation/readiness", missing: { status: 400, error: "pinned problem, registries, provider/environment, and applicability results are required" } },
];

afterEach(() => {
  resetInjectedIdentity(); vi.unstubAllEnvs(); scopeOverride.value = null;
  compileProblem.mockClear(); authorizeExec.mockClear(); readiness.mockClear();
});

describe("B16.0.20 §A — shared refusal classes (all 6 model-simulation routes)", () => {
  it.each(ROUTES)("[$name] unauthenticated → 401; foreign + revoked membership → 403; viewer → 403", async (r) => {
    injectIdentity(null);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(401);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "other", userId: "u1", role: "admin" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "u1", role: "admin", state: "revoked" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    authed("viewer");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    expect(authorizeExec).not.toHaveBeenCalled();
    expect(compileProblem).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] production cross-origin → 403 with ZERO body pulls", async (r) => {
    production(); authed("admin");
    const counter = { pulls: 0 };
    expect((await r.handler(counting(r.path, { origin: "http://evil.example" }, counter))).status).toBe(403);
    expect(counter.pulls).toBe(0);
  });
  it.each(ROUTES)("[$name] text/plain → 415; malformed JSON → 400 AUTH_INVALID_JSON", async (r) => {
    authed("admin");
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
  });
  it.each(ROUTES)("[$name] payload boundary: 64,000,001 → 413; exactly 64,000,000 → under-ceiling 400", async (r) => {
    authed("admin");
    expect((await r.handler(post(r.path, "x".repeat(64_000_001)))).status).toBe(413);
    expect((await r.handler(post(r.path, "x".repeat(64_000_000)))).status).toBe(400);
  });
  it.each(ROUTES)("[$name] pre-aborted request → 400 AUTH_BODY_ABORTED", async (r) => {
    authed("admin");
    const ac = new AbortController(); ac.abort();
    const res = await r.handler(new Request(`http://localhost${r.path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}", signal: ac.signal }));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_BODY_ABORTED");
  });
  it.each(ROUTES)("[$name] authorized empty body → exact required-field refusal; ZERO domain work", async (r) => {
    authed("editor");
    const res = await r.handler(post(r.path, "{}"));
    expect(res.status).toBe(r.missing.status);
    expect((await payload(res)).error).toBe(r.missing.error);
    expect(authorizeExec).not.toHaveBeenCalled();
    expect(compileProblem).not.toHaveBeenCalled();
    expect(readiness).not.toHaveBeenCalled();
  });
});

describe("B16.0.20 §C/§E/§H — actor authority, scope, verdict mappings (pre = post stable)", () => {
  it("[problem] a NON-HUMAN actor cannot compile the authoritative problem → exact 403 (compile never invoked)", async () => {
    authed(); aiScope("pcb_editor");
    const res = await problem(post("/api/model-simulation/problem", JSON.stringify({ schematicProject: {}, circuitVerificationProject: {}, modelRegistry: {}, testbenchRegistry: {}, providers: [], requiredSimulationObligationIds: [] })));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("AI may propose CD-10 inputs but may not compile an authoritative problem");
    expect(compileProblem).not.toHaveBeenCalled();
  });
  it("[problem] verdict mapping: BLOCKED BY CD-9 → 409; ok → 200; other → 422 (spied verdicts)", async () => {
    authed();
    const body = JSON.stringify({ schematicProject: {}, circuitVerificationProject: {}, modelRegistry: {}, testbenchRegistry: {}, providers: [], requiredSimulationObligationIds: [] });
    compileProblem.mockReturnValueOnce({ ok: false, verdict: "BLOCKED BY CD-9" });
    expect((await problem(post("/api/model-simulation/problem", body))).status).toBe(409);
    compileProblem.mockReturnValueOnce({ ok: true, verdict: "ready" });
    expect((await problem(post("/api/model-simulation/problem", body))).status).toBe(200);
    compileProblem.mockReturnValueOnce({ ok: false, verdict: "incomplete" });
    expect((await problem(post("/api/model-simulation/problem", body))).status).toBe(422);
    // the compiled actor is FORCED human with the trusted identity
    const actorArg = (compileProblem.mock.calls[0]![0] as { actor: Record<string, unknown> }).actor;
    expect(actorArg).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
  });
  it("[execute] ai + pcb_editor → exact 403 'AI cannot execute simulation campaigns' (authorization never invoked)", async () => {
    authed(); aiScope("pcb_editor");
    const res = await execute(post("/api/model-simulation/execute", "{}"));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("AI cannot execute simulation campaigns");
    expect(authorizeExec).not.toHaveBeenCalled();
  });
  it("[execute] denied/diagnostic authorization → 409 'authoritative execution denied'; authoritative → 501 BLOCKED runner (exact error, zero further work)", async () => {
    authed();
    const body = JSON.stringify({ provider: {}, environment: {}, manifest: {}, availableContentDigests: [] });
    authorizeExec.mockReturnValueOnce({ authorized: false, mode: "denied" });
    const denied = await execute(post("/api/model-simulation/execute", body));
    expect(denied.status).toBe(409);
    expect((await payload(denied)).error).toBe("authoritative execution denied");
    authorizeExec.mockReturnValueOnce({ authorized: true, mode: "authoritative" });
    const blocked = await execute(post("/api/model-simulation/execute", body));
    expect(blocked.status).toBe(501);
    expect((await payload(blocked)).error).toBe("CD-10 authoritative runner is blocked until the sandbox image/executable and environment corpus are independently validated");
  });
  it("[denominator] foreign problem scope → 403 denominator scope mismatch", async () => {
    authed();
    const res = await denominator(post("/api/model-simulation/denominator", JSON.stringify({ problem: { projectId: "attacker", branchId: "main" }, testbenchRegistry: {}, obligations: [], scenarios: [], providers: [], environments: [], modelBindings: [] })));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("denominator scope mismatch");
  });
  it("[readiness] foreign problem scope → 403; valid (spied report) → 200 { ok, report }", async () => {
    authed();
    const foreign = await readinessRoute(post("/api/model-simulation/readiness", JSON.stringify({ problem: { projectId: "attacker", branchId: "main" }, modelRegistry: {}, testbenchRegistry: {}, provider: {}, environment: {}, applicabilityResults: [] })));
    expect(foreign.status).toBe(403);
    expect((await payload(foreign)).error).toBe("readiness scope mismatch");
    readiness.mockReturnValueOnce({ readiness: "not_ready", blockers: ["x"] });
    const ok = await readinessRoute(post("/api/model-simulation/readiness", JSON.stringify({ problem: { projectId: "proj-1", branchId: "main" }, modelRegistry: {}, testbenchRegistry: {}, provider: {}, environment: {}, applicabilityResults: [] })));
    expect(ok.status).toBe(200);
    expect((await payload(ok)).report).toEqual({ readiness: "not_ready", blockers: ["x"] });
  });
  it("[propose] deterministic (no provider): unknown kind → 400; valid → requiresHumanReview true, proposedBy from trusted context", async () => {
    authed();
    const badKind = await propose(post("/api/model-simulation/propose", JSON.stringify({ problemDigest: "p1", proposalKind: "world_domination", proposedActions: [] })));
    expect(badKind.status).toBe(400);
    const res = await propose(post("/api/model-simulation/propose", JSON.stringify({
      problemDigest: "p1", proposalKind: "measurement",
      proposedActions: [{ action: "add ripple measurement", rationale: "coverage" }],
      targetRefs: ["tb:1"], assumptions: [], warnings: [],
      proposedBy: { actorId: "attacker", actorKind: "ai", role: "project_admin" }, // ignored
    })));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.requiresHumanReview).toBe(true);
    const proposal = body.proposal as { proposedBy: Record<string, unknown> };
    expect(proposal.proposedBy).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
  });
  it("[measure] deterministic evaluation over the supplied run/waveform; no runner/authorization involved", async () => {
    authed();
    const res = await measure(post("/api/model-simulation/measure", JSON.stringify({ runId: "run:1", waveform: { format: "none" }, measurements: [], assertions: [], applicableScenarioCorner: "sc:1" })));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.measurements).toEqual([]);
    expect(body.assertions).toEqual([]);
    expect(authorizeExec).not.toHaveBeenCalled();
  });
});
