/**
 * B16.0.17 §A — PERMANENT route-level parity suite for the tranche-10 migration
 * of the ten CD-8 schematic-compiler methods. Written and run GREEN against the
 * raw handlers, then kept green unchanged after migration to
 * `authenticatedJsonRoute`.
 *
 * No live provider / network / DB. `llmRouter.generate` is a spy.
 * `validateSchematicCompilationProblem` / `validateSchematicGraph` /
 * `validateSchematicProjectState` are spied permissive so the PROVIDER / SCOPE
 * / ACTOR boundary can be exercised without full CD-8 objects — the REAL
 * validators, graph semantics, diff/layout/variant behavior, and the
 * denies-direct-AI-transaction invariant stay covered by the standing
 * `app/api/schematic-compiler/__tests__/routes.test.ts` (unchanged, green) and
 * the schematic-compiler domain suite. `normalizeSchematicChangeProposal` is a
 * pass-through spy over the REAL implementation (overridden only where noted).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/schematic-compiler/problem", async (orig) => ({ ...(await orig() as object), validateSchematicCompilationProblem: vi.fn(() => []) }));
vi.mock("@/app/lib/schematic-compiler/graph", async (orig) => ({ ...(await orig() as object), validateSchematicGraph: vi.fn(() => ({ valid: true, diagnostics: [] })) }));
vi.mock("@/app/lib/schematic-compiler/project", async (orig) => ({ ...(await orig() as object), validateSchematicProjectState: vi.fn(() => []) }));
const createTxn = vi.hoisted(() => vi.fn());
const applyTxn = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/schematic-compiler/transactions", async (orig) => ({ ...(await orig() as object), createSchematicTransaction: createTxn, applySchematicTransaction: applyTxn }));
const normalizeSpy = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/schematic-compiler/agent-tools", async (orig) => {
  const actual = await orig() as { normalizeSchematicChangeProposal: (...a: unknown[]) => unknown };
  normalizeSpy.mockImplementation((...a: unknown[]) => actual.normalizeSchematicChangeProposal(...a));
  return { ...actual, normalizeSchematicChangeProposal: normalizeSpy };
});

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);

import { POST as compare } from "../schematic-compiler/compare/route";
import { POST as diff } from "../schematic-compiler/diff/route";
import { POST as exportRoute } from "../schematic-compiler/export/route";
import { POST as graphValidate } from "../schematic-compiler/graph/validate/route";
import { POST as kicadInspect } from "../schematic-compiler/kicad/inspect/route";
import { POST as layout } from "../schematic-compiler/layout/route";
import { POST as problem } from "../schematic-compiler/problem/route";
import { POST as propose } from "../schematic-compiler/propose/route";
import { POST as transaction } from "../schematic-compiler/transaction/route";
import { POST as variants } from "../schematic-compiler/variants/route";

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
/** A minimal graph carrying EVERY array `normalizeSchematicChangeProposal`
 *  builds its known-ID set from (B16.0.17.1: the original fixture omitted
 *  units/portBindings/bundleDefinitions/graphId, which caused the incidental
 *  TypeError the flawed unknown-ID pin mistook for semantic validation). */
const bareGraph = (projectId = "proj-1"): Record<string, unknown> => ({
  projectId, graphId: "graph:g1", deterministicDigest: "g1",
  components: [], units: [], pins: [], nets: [], endpoints: [], sheetInstances: [], portDefinitions: [], portBindings: [], bundleDefinitions: [],
});

interface RouteCase { name: string; handler: (r: Request) => Promise<Response>; path: string; open: boolean; missing: { status: number; error: string } }
const ROUTES: RouteCase[] = [
  { name: "compare", handler: compare, path: "/api/schematic-compiler/compare", open: false, missing: { status: 400, error: "source graph, independently reparsed graph, and manifest ID are required" } },
  { name: "diff", handler: diff, path: "/api/schematic-compiler/diff", open: false, missing: { status: 400, error: "base and candidate graphs are required" } },
  { name: "export", handler: exportRoute, path: "/api/schematic-compiler/export", open: true, missing: { status: 400, error: "state is required" } },
  { name: "graph/validate", handler: graphValidate, path: "/api/schematic-compiler/graph/validate", open: false, missing: { status: 400, error: "graph is required" } },
  { name: "kicad/inspect", handler: kicadInspect, path: "/api/schematic-compiler/kicad/inspect", open: true, missing: { status: 400, error: "KiCad source string is required" } },
  { name: "layout", handler: layout, path: "/api/schematic-compiler/layout", open: false, missing: { status: 400, error: "graph and sheetInstanceId are required" } },
  { name: "problem", handler: problem, path: "/api/schematic-compiler/problem", open: false, missing: { status: 400, error: "pinned CD-1 through CD-7 states, signoff, atomic snapshot, and variants are required" } },
  { name: "propose", handler: propose, path: "/api/schematic-compiler/propose", open: false, missing: { status: 400, error: "problem, graph, and user request are required" } },
  { name: "transaction", handler: transaction, path: "/api/schematic-compiler/transaction", open: false, missing: { status: 400, error: "state, base digest, idempotency key, reason, and operations are required" } },
  { name: "variants", handler: variants, path: "/api/schematic-compiler/variants", open: false, missing: { status: 400, error: "graph is required" } },
];

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); createTxn.mockReset(); applyTxn.mockReset(); });

describe("B16.0.17 §A — shared refusal classes (all 10 schematic-compiler routes)", () => {
  it.each(ROUTES)("[$name] unauthenticated → 401, provider ZERO", async (r) => {
    injectIdentity(null);
    expect((await r.handler(post(r.path, "{}"))).status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] foreign-project + revoked membership → 403; provider ZERO", async (r) => {
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
    expect((await r.handler(counting(r.path, { origin: "http://evil.example" }, counter))).status).toBe(403);
    expect(counter.pulls).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] text/plain → 415; malformed JSON → 400 AUTH_INVALID_JSON; provider ZERO", async (r) => {
    authed("admin");
    const media = await r.handler(post(r.path, "{}", { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    const bad = await r.handler(post(r.path, "{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    expect(generate).not.toHaveBeenCalled();
  });
  it.each(ROUTES)("[$name] payload boundary: 32,000,001 → 413; 32,000,000 → not 413 (under the ceiling)", async (r) => {
    authed("admin");
    expect((await r.handler(post(r.path, "x".repeat(32_000_001)))).status).toBe(413);
    const at = await r.handler(post(r.path, "x".repeat(32_000_000)));
    expect(at.status).toBe(400); // under the ceiling → reaches JSON parse (invalid-json)
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

describe("B16.0.17 §A — role separation (policy-exact)", () => {
  it("restricted routes deny viewer (403); open routes (export, kicad/inspect) admit viewer to the required-field check", async () => {
    for (const r of ROUTES) {
      authed("viewer");
      const res = await r.handler(post(r.path, "{}"));
      if (r.open) expect(res.status, r.name).toBe(r.missing.status);
      else expect(res.status, r.name).toBe(403);
      resetInjectedIdentity();
    }
  });
});

describe("B16.0.17 §C/§G — trusted scope & actor authority", () => {
  it("[graph/validate] foreign graph.projectId → 403 graph scope mismatch", async () => {
    authed("editor");
    const res = await graphValidate(post("/api/schematic-compiler/graph/validate", JSON.stringify({ graph: bareGraph("attacker") })));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("graph scope mismatch");
  });
  it("[problem] foreign tenant/branch/project body content → 403 schematic problem scope mismatch", async () => {
    authed("editor");
    const states = { requirementsPackage: { projectId: "attacker" }, architectureState: {}, powerState: {}, interfaceState: {}, circuitKnowledgeState: {}, componentSelectionState: {}, calculationState: { projectId: "attacker" }, upstreamSignoff: {}, variantIds: [], atomicLibrarySnapshotId: "snap", tenantId: "attacker", branchId: "attacker" };
    const res = await problem(post("/api/schematic-compiler/problem", JSON.stringify(states)));
    expect(res.status).toBe(403);
    expect((await payload(res)).error).toBe("schematic problem scope mismatch");
  });
  it("[transaction] actor built ONLY from trusted context; body actor/role/session ignored", async () => {
    authed("editor");
    createTxn.mockReturnValue({ transactionId: "t1" });
    applyTxn.mockReturnValue({ record: { state: "accepted" }, state: {} });
    const res = await transaction(post("/api/schematic-compiler/transaction", JSON.stringify({
      state: { projectId: "proj-1", branchId: "main" }, operations: [], reason: "r", idempotencyKey: "k", baseStateDigest: "d",
      actor: { actorId: "attacker", actorKind: "ai", sessionId: "evil", role: "project_admin" }, actorId: "attacker", role: "project_admin",
    })));
    expect(res.status).toBe(200);
    const arg = createTxn.mock.calls[0]![0] as { actor: Record<string, unknown>; tenantId: string; projectId: string; branchId: string };
    expect(arg.actor).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
    expect(arg.tenantId).toBe("local");
    expect(arg.projectId).toBe("proj-1");
    expect(arg.branchId).toBe("main");
  });
  it("[transaction] foreign project scope → 422 before any transaction is created", async () => {
    authed("editor");
    const res = await transaction(post("/api/schematic-compiler/transaction", JSON.stringify({ state: { projectId: "attacker", branchId: "main" }, operations: [], reason: "r", idempotencyKey: "k", baseStateDigest: "d" })));
    expect(res.status).toBe(422);
    expect(createTxn).not.toHaveBeenCalled();
  });
  it("[export] no approved candidate → 422 NOT_RELEASED (explicit non-release handoff)", async () => {
    authed("editor");
    const state = { projectId: "proj-1", branchId: "main", candidates: [], graphs: [], syncContracts: [], roundTripCertificates: [], decision: undefined };
    const res = await exportRoute(post("/api/schematic-compiler/export", JSON.stringify({ state })));
    expect(res.status).toBe(422);
    expect((await payload(res)).status).toBe("NOT_RELEASED");
  });
});

describe("B16.0.17 §D — proposal-only provider boundary", () => {
  const validBody = (): string => JSON.stringify({
    problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" },
    graph: bareGraph(),
    userRequest: "plan the netting",
    provider: "openai",
  });
  it("valid → provider EXACTLY once; maxTokens 4096, temperature 0, forced toolChoice, exact system prompt; proposal_only with null mutations", async () => {
    authed("editor");
    normalizeSpy.mockReturnValueOnce({ proposalId: "prop-1" });
    // [B16.0.17.1] the tool input must satisfy the declared schema — the route
    // now structurally validates BEFORE normalization.
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "propose_schematic_semantic_changes", input: { proposalKind: "review_questions", referencedSemanticObjectIds: [], proposedActions: [], assumptions: [], warnings: [] } }] } as never);
    const res = await propose(post("/api/schematic-compiler/propose", validBody()));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]![0] as { maxTokens: number; temperature: number; system: string; toolChoice: { name: string } };
    expect(call.maxTokens).toBe(4096);
    expect(call.temperature).toBe(0);
    expect(call.toolChoice).toEqual({ name: "propose_schematic_semantic_changes" });
    expect(call.system).toContain("proposal-only CD-8 schematic reasoning assistant");
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only");
    expect(body.graphMutation).toBeNull();
    expect(body.diagramMutation).toBeNull();
    expect(body.pcbMutation).toBeNull();
    expect(res.headers.get("X-Sirkit-AI-Provider")).toBe("openai");
  });
  it("missing typed tool call → 422; provider failure → normalized 503", async () => {
    authed("editor");
    generate.mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [] } as never);
    const noTool = await propose(post("/api/schematic-compiler/propose", validBody()));
    expect(noTool.status).toBe(422);
    expect((await payload(noTool)).error).toBe("provider returned no typed schematic proposal");
    generate.mockRejectedValueOnce(new Error("boom"));
    expect((await propose(post("/api/schematic-compiler/propose", validBody()))).status).toBe(503);
  });
  it("[B16.0.17.1 corrected] a STRUCTURALLY VALID proposal with an unknown semantic ID reaches known-ID validation → deterministic 422 CD8_AI_PROPOSAL_REFERENCE_INVALID", async () => {
    // B16.0.17.1 §A/§B: the original pin's fixture did not satisfy the
    // SCHEMATIC_PROPOSAL_TOOL schema, so it crashed with an incidental
    // TypeError before the known-ID check and proved nothing. This corrected
    // fixture matches the declared tool contract exactly, with ONE unknown id.
    authed("editor");
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "propose_schematic_semantic_changes", input: {
      proposalKind: "connectivity",
      referencedSemanticObjectIds: [],
      proposedActions: [{ actionKind: "connect_pin", targetObjectIds: ["component:unknown"], rationale: "Attempt to reference an unknown semantic object" }],
      assumptions: [], warnings: [],
    } }] } as never);
    const res = await propose(post("/api/schematic-compiler/propose", validBody()));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.code).toBe("CD8_AI_PROPOSAL_REFERENCE_INVALID"); // the known-ID validation, not a provider error
    expect(body.proposal).toBeUndefined();
    expect(normalizeSpy).toHaveBeenCalled();
  });
  it("scope mismatch → 422 with provider ZERO", async () => {
    authed("editor");
    const res = await propose(post("/api/schematic-compiler/propose", JSON.stringify({ problem: { projectId: "attacker", branchId: "main", deterministicDigest: "p" }, graph: bareGraph(), userRequest: "x" })));
    expect(res.status).toBe(422);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("B16.0.17 §E/§F — KiCad quarantine + layout view authority", () => {
  it("[kicad/inspect] authority quarantine_inspection_only, semanticImport null; malformed KiCad stays quarantined (422)", async () => {
    authed("viewer"); // open route
    const ok = await kicadInspect(post("/api/schematic-compiler/kicad/inspect", JSON.stringify({ source: "(kicad_sch (version 20250114))" })));
    const okBody = await payload(ok);
    expect(okBody.authority).toBe("quarantine_inspection_only");
    expect(okBody.semanticImport).toBeNull();
    const bad = await kicadInspect(post("/api/schematic-compiler/kicad/inspect", JSON.stringify({ source: "not kicad at all" })));
    expect(bad.status).toBe(422);
    expect((await payload(bad)).authority).toBe("quarantine_inspection_only");
  });
  it("[compare] remains diagnostic-only 422 with none-certified parser + NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER", async () => {
    authed("editor");
    const res = await compare(post("/api/schematic-compiler/compare", JSON.stringify({ source: bareGraph(), reparsed: bareGraph(), artifactManifestId: "manifest:m1" })));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.ok).toBe(false);
    const cert = JSON.stringify(body.certificate);
    expect(cert).toContain("none-certified");
    expect(cert).toContain("NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER");
  });
});
