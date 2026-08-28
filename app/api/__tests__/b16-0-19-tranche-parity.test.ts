/**
 * B16.0.19 §A — PERMANENT route-level parity suite for the tranche-12
 * migration: five CD-5 circuit-knowledge routes (8 MB) + four CD-9
 * circuit-verification routes (32 MB). Written and run GREEN against the raw
 * handlers, then kept green unchanged after migration.
 *
 * No live provider / network / DB. `llmRouter.generate` is a spy; a minimal
 * set of domain validators is spied permissive to isolate the boundary (REAL
 * validators covered by the standing routes/domain suites); the verification
 * run fixture uses the REAL `finalizeVerification` so digest binding is
 * genuine. §D/§F error-contract changes are pinned in the SEPARATE
 * b16-0-19-proposal-validation suite.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/circuit-knowledge/source", async (orig) => ({
  ...(await orig() as object),
  validateRecipeSourceBundle: vi.fn(() => []),
  validateClaimPromotion: vi.fn(() => []),
}));
vi.mock("@/app/lib/circuit-verification/problem", async (orig) => ({ ...(await orig() as object), validateCircuitVerificationProblem: vi.fn(() => []) }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);
import { finalizeVerification } from "@/app/lib/circuit-verification/stable";
import type { FullOracleRun } from "@/app/lib/circuit-verification/types";

import { POST as ckApplicability } from "../circuit-knowledge/applicability/route";
import { POST as ckCompile } from "../circuit-knowledge/compile/route";
import { POST as ckCompose } from "../circuit-knowledge/compose/route";
import { POST as ckProblem } from "../circuit-knowledge/problem/route";
import { POST as ckPropose } from "../circuit-knowledge/propose/route";
import { POST as cvProblem } from "../circuit-verification/problem/route";
import { POST as cvPropose } from "../circuit-verification/propose/route";
import { POST as cvReadiness } from "../circuit-verification/readiness/route";
import { POST as cvRun } from "../circuit-verification/run/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function authed(role: "viewer" | "editor" | "admin" = "editor"): void {
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role });
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

interface RouteCase { name: string; handler: (r: Request) => Promise<Response>; path: string; maxBytes: number; missing: { status: number; error: string } }
const ROUTES: RouteCase[] = [
  { name: "ck/applicability", handler: ckApplicability, path: "/api/circuit-knowledge/applicability", maxBytes: 8_000_000, missing: { status: 400, error: "recipe, recipeRequest, and context are required" } },
  { name: "ck/compile", handler: ckCompile, path: "/api/circuit-knowledge/compile", maxBytes: 8_000_000, missing: { status: 400, error: "recipe and sourceBundle are required" } },
  { name: "ck/compose", handler: ckCompose, path: "/api/circuit-knowledge/compose", maxBytes: 8_000_000, missing: { status: 400, error: "bindings and recipes arrays are required" } },
  { name: "ck/problem", handler: ckProblem, path: "/api/circuit-knowledge/problem", maxBytes: 8_000_000, missing: { status: 400, error: "pinned CD-1 through CD-4 states plus PCB foundation and exact completion signoffs are required" } },
  { name: "ck/propose", handler: ckPropose, path: "/api/circuit-knowledge/propose", maxBytes: 8_000_000, missing: { status: 400, error: "problem, sourceBundle, and userRequest are required" } },
  { name: "cv/problem", handler: cvProblem, path: "/api/circuit-verification/problem", maxBytes: 32_000_000, missing: { status: 400, error: "approved CD-8 project, CD-1 through CD-8 signoff, approved registry, requirements, and contexts are required" } },
  { name: "cv/propose", handler: cvPropose, path: "/api/circuit-verification/propose", maxBytes: 32_000_000, missing: { status: 400, error: "problem, current full run, and user request are required" } },
  { name: "cv/readiness", handler: cvReadiness, path: "/api/circuit-verification/readiness", maxBytes: 32_000_000, missing: { status: 400, error: "problem, graph digest, registry, and explicit denominator are required" } },
  { name: "cv/run", handler: cvRun, path: "/api/circuit-verification/run", maxBytes: 32_000_000, missing: { status: 400, error: "problem, authoritative graph, and approved registry are required" } },
];

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); });

describe("B16.0.19 §A — shared refusal classes (all 9 routes, both families)", () => {
  it.each(ROUTES)("[$name] unauthenticated → 401, provider ZERO", async (r) => {
    injectIdentity(null);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] foreign + revoked membership → 403; provider ZERO", async (r) => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "other", userId: "u1", role: "admin" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "u1", role: "admin", state: "revoked" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] wrong-role (viewer) → 403", async (r) => {
    authed("viewer");
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
  });
  it.each(ROUTES)("[$name] production cross-origin → 403 with ZERO body pulls + provider ZERO", async (r) => {
    production(); authed("admin");
    const counter = { pulls: 0 };
    expect((await r.handler(counting(r.path, { origin: "http://evil.example" }, counter))).status).toBe(403);
    expect(counter.pulls).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] text/plain → 415; malformed JSON → 400 AUTH_INVALID_JSON", async (r) => {
    authed("admin");
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] payload boundary: maxBytes+1 → 413; exactly maxBytes → under-ceiling 400", async (r) => {
    authed("admin");
    expect((await r.handler(post(r.path, "x".repeat(r.maxBytes + 1)))).status).toBe(413);
    expect((await r.handler(post(r.path, "x".repeat(r.maxBytes)))).status).toBe(400);
  });
  it.each(ROUTES)("[$name] pre-aborted request → 400 AUTH_BODY_ABORTED, provider ZERO", async (r) => {
    authed("admin");
    const ac = new AbortController(); ac.abort();
    const res = await r.handler(new Request(`http://localhost${r.path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: "{}", signal: ac.signal }));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_BODY_ABORTED");
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] authorized empty body → exact required-field refusal (provider ZERO)", async (r) => {
    authed("editor");
    const res = await r.handler(post(r.path, "{}"));
    expect(res.status).toBe(r.missing.status);
    expect((await payload(res)).error).toBe(r.missing.error);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("B16.0.19 §C/§E — trusted scope & provider boundaries (pre = post contracts)", () => {
  it("[ck/problem] foreign tenant/branch/project body → 403 circuit knowledge problem scope mismatch", async () => {
    authed();
    const states = { requirementsPackage: { projectId: "attacker" }, architectureState: { projectId: "attacker" }, powerState: { projectId: "attacker" }, interfaceState: { projectId: "attacker" }, pcbFoundation: {}, upstreamSignoff: {}, tenantId: "attacker", branchId: "attacker" };
    const res = await ckProblem(post("/api/circuit-knowledge/problem", JSON.stringify(states)));
    expect([400, 403]).toContain(res.status);
  });
  it("[ck/propose] scope mismatch → 403 with provider ZERO; valid → exactly-once proposal_only, publicationEligible false, quarantined confidence", async () => {
    authed();
    const foreign = await ckPropose(post("/api/circuit-knowledge/propose", JSON.stringify({ problem: { projectId: "attacker", branchId: "main", deterministicDigest: "p" }, sourceBundle: { sourceBundleId: "sb1", sourceLocations: [] }, userRequest: "x" })));
    expect(foreign.status).toBe(403);
    expect((await payload(foreign)).error).toBe("circuit proposal scope mismatch");
    expect(generate).not.toHaveBeenCalled();
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "propose_circuit_recipe_claim", input: { claimKind: "decoupling", proposedValue: { note: "x" }, conditions: [], sourceEvidenceRefs: ["ev:1"], sourceLocationRefs: ["loc:1"], reviewerQueueIds: ["rq:1"] } }] } as never);
    const res = await ckPropose(post("/api/circuit-knowledge/propose", JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, sourceBundle: { sourceBundleId: "sb1", sourceLocations: [] }, userRequest: "extract", provider: "openai" })));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]![0] as { maxTokens: number; temperature: number; toolChoice: { name: string }; system: string };
    expect(call.maxTokens).toBe(4096);
    expect(call.temperature).toBe(0);
    expect(call.toolChoice).toEqual({ name: "propose_circuit_recipe_claim" });
    expect(call.system).toContain("proposal-only circuit-knowledge extraction assistant");
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only");
    expect(body.publicationEligible).toBe(false);
    const proposal = body.proposal as Record<string, unknown>;
    expect(proposal.confidence).toBe("low");
    expect(proposal.authorityAssessment).toBe("unknown");
    expect(res.headers.get("X-Sirkit-AI-Provider")).toBe("openai");
  });
  it("[cv/run + cv/readiness] scope/pin mismatches refuse before oracle/readiness work", async () => {
    authed();
    const run = await cvRun(post("/api/circuit-verification/run", JSON.stringify({ problem: { projectId: "attacker", branchId: "main" }, graph: { projectId: "proj-1" }, registry: {} })));
    expect([400, 422]).toContain(run.status);
    const readiness = await cvReadiness(post("/api/circuit-verification/readiness", JSON.stringify({ problem: { projectId: "attacker", branchId: "main" }, graphDigest: "g", registry: {}, denominator: {} })));
    expect([400, 403]).toContain(readiness.status);
  });
  it("[cv/propose] valid pinned problem+run → exactly-once; proposal_only_no_design_or_verdict_mutation; all five mutations null", async () => {
    authed();
    const runBase = { runId: "run:1", runKind: "full", problemDigest: "p1", graphDigest: "g1", findings: [], deterministicDigest: "" } as unknown as FullOracleRun;
    const run = finalizeVerification(runBase); // REAL digest — genuine binding
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [] } as never);
    const res = await cvPropose(post("/api/circuit-verification/propose", JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, run, userRequest: "help", provider: "openai" })));
    // no tool call → historical 422 (valid-path shape covered in the §F suite)
    expect(res.status).toBe(422);
    expect((await payload(res)).error).toBe("provider returned no typed verification remediation proposal");
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]![0] as { maxTokens: number; temperature: number; toolChoice: { name: string }; system: string };
    expect(call.maxTokens).toBe(4096);
    expect(call.temperature).toBe(0);
    expect(call.toolChoice).toEqual({ name: "propose_circuit_verification_remediation" });
    expect(call.system).toContain("proposal-only CD-9 circuit verification assistant");
  });
  it("[cv/propose] stale run digest or non-full runKind → 422 with provider ZERO", async () => {
    authed();
    const stale = await cvPropose(post("/api/circuit-verification/propose", JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, run: { runId: "run:1", runKind: "full", problemDigest: "p1", graphDigest: "g1", findings: [], deterministicDigest: "TAMPERED" }, userRequest: "x" })));
    expect(stale.status).toBe(422);
    expect((await payload(stale)).error).toBe("pinned verification problem/run integrity or scope failed");
    expect(generate).not.toHaveBeenCalled();
  });
});
