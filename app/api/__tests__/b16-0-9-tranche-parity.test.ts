/**
 * B16.0.9 §A/§D — BEHAVIORAL CONTRACT PINS for the tranche-2 migration
 * (architecture ×5, power ×6, interfaces ×6 — all authenticated JSON, 8 MB /
 * 30 s). Written and run GREEN against the PRE-migration handlers, then kept
 * green after each method moves to `authenticatedJsonRoute`.
 *
 * Pins per method: anonymous 401 with ZERO body pulls; production cross-origin
 * CSRF 403 with ZERO pulls; 415 with ZERO pulls; malformed JSON 400
 * AUTH_INVALID_JSON; oversized 413; the route's own scope-mismatch/required-
 * field refusal (exact status + public error string). Provider-bound routes
 * additionally prove ZERO provider calls on every refusal, exactly-once
 * invocation with requested-provider routing on the valid path, and
 * provider-error normalization — via a fake adapter (vi.mock), no credits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);
import { architectureProblem, architectureProposal } from "@/app/lib/architecture/__tests__/fixtures";
import { powerProblem as powerProblemFixture } from "@/app/lib/power/__tests__/fixtures";
import { interfaceProblem, interfaceProblemInput } from "@/app/lib/interfaces/__tests__/fixtures";
import { synthesizePowerArchitectureProposals } from "@/app/lib/power/alternatives";
import { synthesizeInterfacePlanningProposals } from "@/app/lib/interfaces/alternatives";
import { ARCHITECTURE_PROPOSAL_JSON_SCHEMA } from "@/app/lib/architecture/proposal-schema";
import { POWER_PROPOSAL_TOOL_NAME } from "@/app/lib/power/proposal-schema";
import { INTERFACE_PROPOSAL_TOOL_NAME } from "@/app/lib/interfaces/proposal-schema";

import { POST as archAlternatives } from "../architecture/alternatives/route";
import { POST as archCandidates } from "../architecture/candidates/route";
import { POST as archCompare } from "../architecture/compare/route";
import { POST as archProblem } from "../architecture/problem/route";
import { POST as archPropose } from "../architecture/propose/route";
import { POST as powerAlternatives } from "../power/alternatives/route";
import { POST as powerCandidates } from "../power/candidates/route";
import { POST as powerCompare } from "../power/compare/route";
import { POST as powerProblem } from "../power/problem/route";
import { POST as powerPropose } from "../power/propose/route";
import { POST as powerReconcile } from "../power/reconcile/route";
import { POST as ifaceAllocate } from "../interfaces/allocate/route";
import { POST as ifaceAlternatives } from "../interfaces/alternatives/route";
import { POST as ifaceCandidates } from "../interfaces/candidates/route";
import { POST as ifaceCompare } from "../interfaces/compare/route";
import { POST as ifaceProblem } from "../interfaces/problem/route";
import { POST as ifacePropose } from "../interfaces/propose/route";

const PROJECT = "proj-1";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const OVERSIZE = "x".repeat(8_000_001); // shared 8 MB + 1 raw body (over every route's ceiling)

interface RouteCase {
  name: string;
  path: string;
  handler: (r: Request) => Promise<Response>;
  /** The route's own post-boundary refusal: body → expected status + error. */
  refusal: { body: Record<string, unknown>; status: number; error: string };
}
const ROUTES: RouteCase[] = [
  { name: "architecture/alternatives", path: "/api/architecture/alternatives", handler: archAlternatives, refusal: { body: { problem: { projectId: "other", branchId: "main" } }, status: 403, error: "architecture alternative scope mismatch" } },
  { name: "architecture/candidates", path: "/api/architecture/candidates", handler: archCandidates, refusal: { body: { problem: { projectId: "other" }, proposal: {} }, status: 403, error: "architecture candidate scope mismatch" } },
  { name: "architecture/compare", path: "/api/architecture/compare", handler: archCompare, refusal: { body: { candidates: [{ projectId: "other" }] }, status: 403, error: "candidate scope mismatch" } },
  { name: "architecture/problem", path: "/api/architecture/problem", handler: archProblem, refusal: { body: { requirementsPackage: { projectId: "other" } }, status: 403, error: "architecture problem scope mismatch" } },
  { name: "architecture/propose", path: "/api/architecture/propose", handler: archPropose, refusal: { body: { problem: { projectId: "other" }, userRequest: "explore" }, status: 403, error: "architecture proposal scope mismatch" } },
  { name: "power/alternatives", path: "/api/power/alternatives", handler: powerAlternatives, refusal: { body: { problem: { projectId: "other", branchId: "main" } }, status: 403, error: "power alternative scope mismatch" } },
  { name: "power/candidates", path: "/api/power/candidates", handler: powerCandidates, refusal: { body: { problem: { projectId: "other" }, proposal: {} }, status: 403, error: "power candidate scope mismatch" } },
  { name: "power/compare", path: "/api/power/compare", handler: powerCompare, refusal: { body: { candidates: [{ projectId: PROJECT }, { projectId: "other" }] }, status: 403, error: "at least two same-project candidates are required" } },
  { name: "power/problem", path: "/api/power/problem", handler: powerProblem, refusal: { body: { requirementsPackage: { projectId: "other" }, architectureState: { projectId: PROJECT }, upstreamSignoff: {}, capabilityProfile: {} }, status: 403, error: "power problem scope mismatch" } },
  { name: "power/propose", path: "/api/power/propose", handler: powerPropose, refusal: { body: { problem: { projectId: "other" }, userRequest: "explore" }, status: 403, error: "power proposal scope mismatch" } },
  { name: "power/reconcile", path: "/api/power/reconcile", handler: powerReconcile, refusal: { body: { candidate: { projectId: "other" }, expansions: [] }, status: 403, error: "candidate scope or expansions invalid" } },
  { name: "interfaces/allocate", path: "/api/interfaces/allocate", handler: ifaceAllocate, refusal: { body: {}, status: 400, error: "candidate, exact fact snapshot, and resource requirements are required" } },
  { name: "interfaces/alternatives", path: "/api/interfaces/alternatives", handler: ifaceAlternatives, refusal: { body: { problem: { projectId: "other", branchId: "main" }, architecture: {}, power: {} }, status: 403, error: "interface alternative scope mismatch" } },
  { name: "interfaces/candidates", path: "/api/interfaces/candidates", handler: ifaceCandidates, refusal: { body: { problem: { projectId: "other" }, architecture: {}, power: {}, proposal: {} }, status: 403, error: "interface candidate scope mismatch" } },
  { name: "interfaces/compare", path: "/api/interfaces/compare", handler: ifaceCompare, refusal: { body: { candidates: [{ projectId: PROJECT }, { projectId: "other" }] }, status: 403, error: "at least two same-project candidates are required" } },
  { name: "interfaces/problem", path: "/api/interfaces/problem", handler: ifaceProblem, refusal: { body: { requirementsPackage: { projectId: "other" }, architectureState: { projectId: PROJECT }, powerState: { projectId: PROJECT }, upstreamSignoff: {} }, status: 403, error: "interface problem scope mismatch" } },
  { name: "interfaces/propose", path: "/api/interfaces/propose", handler: ifacePropose, refusal: { body: { problem: { projectId: "other" }, architecture: {}, power: {}, userRequest: "explore" }, status: 403, error: "interface proposal scope mismatch" } },
];
// Minimally-SHAPED problems: in-scope, but failing integrity validation with
// diagnostics (the validators dereference these fields, so they must exist).
const ARCH_PROBLEM_SHAPE = { projectId: PROJECT, branchId: "main", tenantId: "local", problemId: "p1", schemaVersion: "wrong", compilerVersion: "wrong", requirementsPackageRef: { status: "draft" }, selectedCapabilityProfileRefs: [], requirements: [], functionalCapabilities: [], deterministicDigest: "wrong" };
const IFACE_PROBLEM_SHAPE = { projectId: PROJECT, branchId: "main", problemId: "p1", schemaVersion: "wrong", requirementsPackageRevision: { digest: "d" }, systemArchitectureCandidateRevision: { candidateDigest: "d" }, powerArchitectureCandidateRevision: { candidateDigest: "d" }, policyRuleRegistryRevision: "r", capabilityProfileRevision: "r", deterministicDigest: "wrong", architectureEndpointIds: [], interfaceObligationIds: [] };
const PROPOSE: Array<{ name: string; handler: (r: Request) => Promise<Response>; validScopeBody: Record<string, unknown>; integrityError: string }> = [
  { name: "architecture/propose", handler: archPropose, validScopeBody: { problem: ARCH_PROBLEM_SHAPE, userRequest: "explore" }, integrityError: "architecture problem integrity failed" },
  { name: "power/propose", handler: powerPropose, validScopeBody: { problem: { projectId: PROJECT, branchId: "main" }, userRequest: "explore" }, integrityError: "power problem integrity failed" },
  { name: "interfaces/propose", handler: ifacePropose, validScopeBody: { problem: IFACE_PROBLEM_SHAPE, architecture: { projectId: PROJECT }, power: { projectId: PROJECT }, userRequest: "explore" }, integrityError: "interface problem integrity failed" },
];

const authed = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: PROJECT, role: "editor" }); };
function jsonReq(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
function countingReq(path: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); });

describe("B16.0.9 §A — security boundary pins (all 17 methods)", () => {
  it.each(ROUTES)("[$name] anonymous → 401 AUTH_UNAUTHENTICATED with ZERO body pulls (and zero provider calls)", async (route) => {
    injectIdentity(null);
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route.path, { origin: "http://localhost" }, counter));
    expect(res.status).toBe(401);
    expect((await payload(res)).code).toBe("AUTH_UNAUTHENTICATED");
    expect(counter.pulls).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("[$name] production cross-origin → 403 with ZERO body pulls", async (route) => {
    stubProduction();
    authed();
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route.path, { origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("[$name] text/plain → 415 AUTH_MEDIA_TYPE_UNSUPPORTED with ZERO body pulls", async (route) => {
    authed();
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route.path, { origin: "http://localhost", "content-type": "text/plain" }, counter));
    expect(res.status).toBe(415);
    expect((await payload(res)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect(counter.pulls).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("[$name] malformed JSON → 400 AUTH_INVALID_JSON", async (route) => {
    authed();
    const res = await route.handler(jsonReq(route.path, "{not json"));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_INVALID_JSON");
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("[$name] oversized body (8 MB + 1) → 413 AUTH_PAYLOAD_TOO_LARGE", async (route) => {
    authed();
    const res = await route.handler(jsonReq(route.path, OVERSIZE));
    expect(res.status).toBe(413);
    expect((await payload(res)).code).toBe("AUTH_PAYLOAD_TOO_LARGE");
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(ROUTES)("[$name] the route's own refusal (scope/required) — exact status + error string", async (route) => {
    authed();
    const res = await route.handler(jsonReq(route.path, JSON.stringify(route.refusal.body)));
    expect(res.status).toBe(route.refusal.status);
    expect((await payload(res)).error).toBe(route.refusal.error);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("B16.0.9 §D — provider-bound routes: zero-call refusals + routing parity (fake adapter)", () => {
  it.each(PROPOSE)("[$name] problem integrity failure → 422 with diagnostics and ZERO provider calls", async (route) => {
    authed();
    const res = await route.handler(jsonReq(`/api/${route.name}`, JSON.stringify(route.validScopeBody)));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.error).toBe(route.integrityError);
    expect(Array.isArray(body.diagnostics)).toBe(true);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("B16.0.9 §D — valid provider path: exactly-once invocation, requested-provider routing, error normalization", () => {
  // Digest-valid problems from the REAL family fixtures (deterministic).
  const validCases = (): Array<{ name: string; handler: (r: Request) => Promise<Response>; body: () => Record<string, unknown>; toolName: string; toolInput: (body: Record<string, unknown>) => unknown }> => [
    { name: "architecture/propose", handler: archPropose, toolName: ARCHITECTURE_PROPOSAL_JSON_SCHEMA.name, body: () => ({ problem: architectureProblem(), userRequest: "explore", provider: "anthropic" }), toolInput: (b) => architectureProposal(b.problem as never) },
    { name: "power/propose", handler: powerPropose, toolName: POWER_PROPOSAL_TOOL_NAME, body: () => ({ problem: powerProblemFixture(), userRequest: "explore", provider: "anthropic" }), toolInput: (b) => synthesizePowerArchitectureProposals(b.problem as never)[0] },
    {
      name: "interfaces/propose", handler: ifacePropose, toolName: INTERFACE_PROPOSAL_TOOL_NAME, body: () => {
        const input = interfaceProblemInput();
        const problem = interfaceProblem();
        const architecture = input.architectureState.candidates.find((c) => c.candidateId === input.architectureState.selection!.candidateId)!;
        const power = input.powerState.candidates.find((c) => c.candidateId === input.powerState.selection!.candidateId)!;
        return { problem, architecture, power, userRequest: "explore", provider: "anthropic" };
      }, toolInput: (b) => synthesizeInterfacePlanningProposals(b.problem as never, b.architecture as never)[0],
    },
  ];

  const authAs = (projectId: string, tenantId: string, branchId: string): Record<string, string> => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId, projectId, role: "editor" });
    return { "x-sirkit-tenant-id": tenantId, "x-sirkit-project-id": projectId, "x-sirkit-branch-id": branchId };
  };

  it.each(validCases())("[$name] valid call → generate ONCE with the REQUESTED provider; X-Sirkit-AI-Provider + no-store; deterministic 200 on a real fixture proposal", async (route) => {
    const body = route.body();
    const problem = body.problem as { projectId: string; tenantId?: string; branchId: string };
    const sel = authAs(problem.projectId, problem.tenantId ?? "local", problem.branchId);
    generate.mockResolvedValue({ provider: "anthropic", model: "m-test", toolCalls: [{ name: route.toolName, input: route.toolInput(body) }] } as never);
    const res = await route.handler(new Request(`http://localhost/api/${route.name}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...sel }, body: JSON.stringify(body) }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect((generate.mock.calls[0]![0] as { provider: string }).provider).toBe("anthropic"); // requested-provider routing preserved
    expect(res.headers.get("X-Sirkit-AI-Provider")).toBe("anthropic");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.status).toBe(200); // a REAL fixture proposal compiles deterministically
    expect((await payload(res)).ok).toBe(true);
  });

  it.each(validCases())("[$name] provider failure → normalized 503, generate called exactly once", async (route) => {
    const body = route.body();
    const problem = body.problem as { projectId: string; tenantId?: string; branchId: string };
    const sel = authAs(problem.projectId, problem.tenantId ?? "local", problem.branchId);
    generate.mockRejectedValue(new Error("boom"));
    const res = await route.handler(new Request(`http://localhost/api/${route.name}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...sel }, body: JSON.stringify(body) }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(503);
    expect((await payload(res)).ok).toBe(false);
  });
});
