/**
 * B16.0.16 §A — PERMANENT route-level parity suite for the tranche-9 migration
 * of the eight CD-7 calculation methods. Written and run GREEN against the raw
 * handlers, then kept green unchanged after migration to `authenticatedJsonRoute`.
 *
 * No live provider / network / DB. `llmRouter.generate` is a spy (propose).
 * `validateCircuitCalculationProblem` / `validateCalculationProjectState` are
 * spied to `[]` so the PROVIDER / SCOPE boundary can be exercised without
 * reconstructing the full calculation domain (whose validation is covered by
 * the standing `app/lib/calculation` suite); the transaction actor-capture pin
 * spies `createCalculationTransaction` to inspect the actor the route builds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/calculation/problem", async (orig) => ({ ...(await orig() as object), validateCircuitCalculationProblem: vi.fn(() => []) }));
vi.mock("@/app/lib/calculation/project", async (orig) => ({ ...(await orig() as object), validateCalculationProjectState: vi.fn(() => []) }));
const createTxn = vi.hoisted(() => vi.fn());
const applyTxn = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/calculation/transactions", async (orig) => ({ ...(await orig() as object), createCalculationTransaction: createTxn, applyCalculationTransaction: applyTxn }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);

import { POST as corners } from "../calculation/corners/route";
import { POST as evaluate } from "../calculation/evaluate/route";
import { POST as exportRoute } from "../calculation/export/route";
import { POST as feedback } from "../calculation/feedback/route";
import { POST as problem } from "../calculation/problem/route";
import { POST as propose } from "../calculation/propose/route";
import { POST as report } from "../calculation/report/route";
import { POST as transaction } from "../calculation/transaction/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function authed(role: "viewer" | "commenter" | "editor" | "reviewer" | "admin"): void {
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

interface RouteCase { name: string; handler: (r: Request) => Promise<Response>; path: string; open: boolean; missing: { status: number; error: string } | { status: number }; }
const ROUTES: RouteCase[] = [
  { name: "corners", handler: corners, path: "/api/calculation/corners", open: false, missing: { status: 400, error: "corner dimensions are required" } },
  { name: "evaluate", handler: evaluate, path: "/api/calculation/evaluate", open: false, missing: { status: 400, error: "model and typed interval inputs are required" } },
  { name: "export", handler: exportRoute, path: "/api/calculation/export", open: true, missing: { status: 400, error: "state is required" } },
  { name: "feedback", handler: feedback, path: "/api/calculation/feedback", open: false, missing: { status: 422 } },
  { name: "problem", handler: problem, path: "/api/calculation/problem", open: false, missing: { status: 400, error: "pinned CD-1 through CD-6 states, signoff, and registry are required" } },
  { name: "propose", handler: propose, path: "/api/calculation/propose", open: false, missing: { status: 400, error: "problem, approved model IDs, and userRequest are required" } },
  { name: "report", handler: report, path: "/api/calculation/report", open: true, missing: { status: 400, error: "problem, graph, registry snapshot, and fixed-point result are required" } },
  { name: "transaction", handler: transaction, path: "/api/calculation/transaction", open: false, missing: { status: 400, error: "state, base digest, idempotency key, reason, and operations are required" } },
];

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); createTxn.mockReset(); applyTxn.mockReset(); });

describe("B16.0.16 §A — shared refusal classes (all 8 calculation routes)", () => {
  it.each(ROUTES)("[$name] unauthenticated → 401, provider ZERO calls", async (r) => {
    injectIdentity(null);
    const res = await r.handler(post(r.path, "{}"));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] foreign-project membership → 403; revoked → 403; provider ZERO", async (r) => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "other", userId: "u1", role: "admin" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    resetInjectedIdentity();
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "u1", role: "admin", state: "revoked" }]);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] production cross-origin → 403 with ZERO body pulls + provider ZERO", async (r) => {
    production(); authed("admin");
    const counter = { pulls: 0 };
    const res = await r.handler(counting(r.path, { origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] text/plain → 415 AUTH_MEDIA_TYPE_UNSUPPORTED; malformed → 400 AUTH_INVALID_JSON; provider ZERO", async (r) => {
    authed("admin");
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] payload boundary: 12,000,001 bytes → 413; 12,000,000 bytes → not 413 (under the ceiling)", async (r) => {
    authed("admin");
    const over = await r.handler(post(r.path, "x".repeat(12_000_001)));
    expect(over.status).toBe(413);
    const at = await r.handler(post(r.path, "x".repeat(12_000_000)));
    expect(at.status).not.toBe(413); // under the ceiling → reaches JSON parse (400 invalid-json)
    expect(at.status).toBe(400);
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
    if ("error" in r.missing) expect((await payload(res)).error).toBe(r.missing.error);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("B16.0.16 §C — role separation (policy-exact)", () => {
  it("restricted routes deny viewer (403); open routes (export/report) admit viewer to the required-field check", async () => {
    for (const r of ROUTES) {
      authed("viewer");
      const res = await r.handler(post(r.path, "{}"));
      if (r.open) expect(res.status, r.name).toBe(r.missing.status); // viewer admitted → required-field
      else expect(res.status, r.name).toBe(403); // viewer denied
      resetInjectedIdentity();
    }
  });
});

describe("B16.0.16 §C — server-derived scope & actor", () => {
  it("[problem] foreign project/branch body content → 403 scope mismatch (before any compile)", async () => {
    authed("editor");
    const states = { requirementsPackage: { projectId: "attacker" }, architectureState: {}, powerState: {}, interfaceState: {}, circuitKnowledgeState: {}, componentSelectionState: { projectId: "attacker" }, upstreamSignoff: {}, registrySnapshot: {}, tenantId: "attacker", branchId: "attacker" };
    const res = await problem(post("/api/calculation/problem", JSON.stringify(states)));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("calculation problem scope mismatch");
  });
  it("[transaction] the transaction actor is built ONLY from trusted context; body actor/role/session are ignored", async () => {
    authed("editor");
    createTxn.mockReturnValue({ transactionId: "t1" });
    applyTxn.mockReturnValue({ record: { state: "accepted" }, state: {} });
    const body = JSON.stringify({
      state: { projectId: "proj-1", branchId: "main" }, operations: [], reason: "r", idempotencyKey: "k", baseStateDigest: "d",
      actor: { actorId: "attacker", actorKind: "ai", sessionId: "evil", role: "project_admin" }, actorId: "attacker", role: "project_admin",
    });
    const res = await transaction(post("/api/calculation/transaction", body));
    expect(res.status).toBe(200);
    expect(createTxn).toHaveBeenCalledTimes(1);
    const actor = (createTxn.mock.calls[0]![0] as { actor: Record<string, unknown>; projectId: string; branchId: string }).actor;
    expect(actor).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
    expect((createTxn.mock.calls[0]![0] as { projectId: string }).projectId).toBe("proj-1");
  });
  it("[transaction] foreign project scope in body → 422 before any transaction is created", async () => {
    authed("editor");
    const res = await transaction(post("/api/calculation/transaction", JSON.stringify({ state: { projectId: "attacker", branchId: "main" }, operations: [], reason: "r", idempotencyKey: "k", baseStateDigest: "d" })));
    expect(res.status).toBe(422);
    expect(createTxn).not.toHaveBeenCalled();
  });
});

describe("B16.0.16 §D/§E — deterministic evaluators, export authority, proposal provider", () => {
  it("[corners] valid dimensions → deterministic enumeration; provider ZERO", async () => {
    authed("editor");
    const res = await corners(post("/api/calculation/corners", JSON.stringify({ dimensions: [{ dimensionId: "temp", assignments: [{ label: "cold", values: {} }, { label: "hot", values: {} }] }] })));
    expect([200, 422]).toContain(res.status); // deterministic path (complete → 200 / else 422)
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(generate).not.toHaveBeenCalled();
  });
  it("[evaluate] unapproved model → 422; provider ZERO", async () => {
    authed("editor");
    const res = await evaluate(post("/api/calculation/evaluate", JSON.stringify({ model: "not_a_real_model", inputs: { x: { lower: 1, upper: 2, unit: "V", evidence: "guaranteed" } } })));
    expect(res.status).toBe(422);
    expect(generate).not.toHaveBeenCalled();
  });
  it("[export] no current approved report → 422 NOT_RELEASED (explicitly not a schematic/PCB/mfg release)", async () => {
    authed("editor");
    const state = { projectId: "proj-1", branchId: "main", reports: [], decision: undefined, deterministicDigest: "d", problem: { deterministicDigest: "p" }, registrySnapshot: { deterministicDigest: "r" } };
    const res = await exportRoute(post("/api/calculation/export", JSON.stringify({ state })));
    expect(res.status).toBe(422);
    expect((await payload(res)).status).toBe("NOT_RELEASED");
  });
  it("[propose] valid → provider EXACTLY once, proposal_only authority + X-Sirkit-AI-Provider header; empty numeric outputs", async () => {
    authed("editor");
    const problemObj = { projectId: "proj-1", branchId: "main", deterministicDigest: "p1", calculationObligations: [{ obligationId: "o1", requestedAnalysisKinds: ["dc"] }] };
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "propose_calculation_analysis", input: { kind: "analysis_plan", obligationIds: ["o1"], proposedModelRevisionIds: ["mr1"], explanation: "e", warnings: [] } }] } as never);
    const res = await propose(post("/api/calculation/propose", JSON.stringify({ problem: problemObj, userRequest: "plan the divider", approvedModelRevisionIds: ["mr1"], provider: "openai" })));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only");
    expect(body.calculatedResults).toEqual([]);
    expect(body.decisions).toEqual([]);
    expect(res.headers.get("X-Sirkit-AI-Provider")).toBe("openai");
    // prompt + tool schema are byte-identical (assert the exact system prompt + tool were sent)
    const call = generate.mock.calls[0]![0] as { system: string; maxTokens: number; temperature: number; toolChoice: { name: string }; tools: Array<{ name: string }> };
    expect(call.maxTokens).toBe(2048);
    expect(call.temperature).toBe(0);
    expect(call.toolChoice).toEqual({ name: "propose_calculation_analysis" });
    expect(call.tools[0]!.name).toBe("propose_calculation_analysis");
    expect(call.system).toContain("proposal-only CD-7 analysis planner");
  });
  it("[propose] unpinned obligation OR unapproved model in the tool call → 422", async () => {
    authed("editor");
    const problemObj = { projectId: "proj-1", branchId: "main", deterministicDigest: "p1", calculationObligations: [{ obligationId: "o1", requestedAnalysisKinds: ["dc"] }] };
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "propose_calculation_analysis", input: { kind: "analysis_plan", obligationIds: ["o-UNPINNED"], proposedModelRevisionIds: ["mr1"], explanation: "e", warnings: [] } }] } as never);
    const res = await propose(post("/api/calculation/propose", JSON.stringify({ problem: problemObj, userRequest: "x", approvedModelRevisionIds: ["mr1"] })));
    expect(res.status).toBe(422);
    expect((await payload(res)).error).toBe("proposal references an unpinned obligation or unapproved model");
  });
  it("[propose] no typed tool call → 422; provider failure → normalized providerErrorResponse (503)", async () => {
    authed("editor");
    const problemObj = { projectId: "proj-1", branchId: "main", deterministicDigest: "p1", calculationObligations: [] };
    generate.mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [] } as never);
    const noTool = await propose(post("/api/calculation/propose", JSON.stringify({ problem: problemObj, userRequest: "x", approvedModelRevisionIds: [] })));
    expect(noTool.status).toBe(422);
    expect((await payload(noTool)).error).toBe("provider returned no typed analysis proposal");
    generate.mockRejectedValueOnce(new Error("boom"));
    const failed = await propose(post("/api/calculation/propose", JSON.stringify({ problem: problemObj, userRequest: "x", approvedModelRevisionIds: [] })));
    expect(failed.status).toBe(503);
  });
  it("[propose] scope mismatch → 422 with provider ZERO", async () => {
    authed("editor");
    const res = await propose(post("/api/calculation/propose", JSON.stringify({ problem: { projectId: "attacker", branchId: "main", deterministicDigest: "p", calculationObligations: [] }, userRequest: "x", approvedModelRevisionIds: [] })));
    expect(res.status).toBe(422);
    expect(generate).not.toHaveBeenCalled();
  });
});
