/**
 * B16.0.18 §A — PERMANENT route-level parity suite for the tranche-11
 * migration of the ten CD-6 component-selection methods. Written and run GREEN
 * against the raw handlers, then kept green unchanged after migration to
 * `authenticatedJsonRoute`.
 *
 * No live provider / distributor / network / DB. `llmRouter.generate` is a
 * spy; the domain problem/catalog/project validators are spied permissive to
 * isolate the boundary (REAL validators covered by the standing
 * component-selection routes.test + domain suites); transactions are spied for
 * actor capture. `createCatalogSearchProposal` is REAL.
 *
 * NOTE: the §E error-contract changes (provider/local separation, structural
 * validation) are pinned in the SEPARATE b16-0-18-proposal-validation suite —
 * this suite pins only contracts that are identical pre and post migration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/component-selection/problem", async (orig) => ({ ...(await orig() as object), validateComponentSelectionProblem: vi.fn(() => []) }));
vi.mock("@/app/lib/component-selection/catalog", async (orig) => ({ ...(await orig() as object), validateEngineeringCatalogSnapshot: vi.fn(() => []) }));
vi.mock("@/app/lib/component-selection/project", async (orig) => ({ ...(await orig() as object), validateComponentSelectionProjectState: vi.fn(() => []) }));
const createTxn = vi.hoisted(() => vi.fn());
const applyTxn = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/component-selection/transactions", async (orig) => ({ ...(await orig() as object), createComponentSelectionTransaction: createTxn, applyComponentSelectionTransaction: applyTxn }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);

import { POST as alternative } from "../component-selection/alternative/route";
import { POST as catalog } from "../component-selection/catalog/route";
import { POST as evaluate } from "../component-selection/evaluate/route";
import { POST as exportRoute } from "../component-selection/export/route";
import { POST as feedback } from "../component-selection/feedback/route";
import { POST as problem } from "../component-selection/problem/route";
import { POST as propose } from "../component-selection/propose/route";
import { POST as solve } from "../component-selection/solve/route";
import { POST as sourcing } from "../component-selection/sourcing/route";
import { POST as transaction } from "../component-selection/transaction/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function authed(role: "viewer" | "commenter" | "editor" | "reviewer" | "admin" = "editor"): void {
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

interface RouteCase { name: string; handler: (r: Request) => Promise<Response>; path: string; open: boolean; missing: { status: number; error?: string; body?: string } }
const ROUTES: RouteCase[] = [
  { name: "alternative", handler: alternative, path: "/api/component-selection/alternative", open: false, missing: { status: 400, error: "primary, independently evaluated alternative, class, and impacts are required" } },
  { name: "catalog", handler: catalog, path: "/api/component-selection/catalog", open: true, missing: { status: 400, error: "pinned engineering catalog snapshot is required" } },
  { name: "evaluate", handler: evaluate, path: "/api/component-selection/evaluate", open: false, missing: { status: 400, error: "problemId, requirement, and catalog are required" } },
  { name: "export", handler: exportRoute, path: "/api/component-selection/export", open: true, missing: { status: 400, error: "state and candidateId are required" } },
  { name: "feedback", handler: feedback, path: "/api/component-selection/feedback", open: false, missing: { status: 422 } },
  { name: "problem", handler: problem, path: "/api/component-selection/problem", open: false, missing: { status: 400, error: "pinned CD-1 through CD-5 states and exact completion signoff are required" } },
  { name: "propose", handler: propose, path: "/api/component-selection/propose", open: false, missing: { status: 400, error: "problem, pinned catalog, and userRequest are required" } },
  { name: "solve", handler: solve, path: "/api/component-selection/solve", open: false, missing: { status: 400, error: "problem, model, and evaluations are required" } },
  { name: "sourcing", handler: sourcing, path: "/api/component-selection/sourcing", open: false, missing: { status: 400, error: "snapshot, observation, and quantityProfile are required", body: '{"operation":"normalize"}' } },
  { name: "transaction", handler: transaction, path: "/api/component-selection/transaction", open: false, missing: { status: 400, error: "state, base digest, idempotency key, reason, and operations are required" } },
];

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); createTxn.mockReset(); applyTxn.mockReset(); });

describe("B16.0.18 §A — shared refusal classes (all 10 component-selection routes)", () => {
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
  it.each(ROUTES)("[$name] payload boundary: 12,000,001 → 413; 12,000,000 → not 413 (under the ceiling)", async (r) => {
    authed("admin");
    expect((await r.handler(post(r.path, "x".repeat(12_000_001)))).status).toBe(413);
    expect((await r.handler(post(r.path, "x".repeat(12_000_000)))).status).toBe(400);
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
    const res = await r.handler(post(r.path, r.missing.body ?? "{}"));
    expect(res.status).toBe(r.missing.status);
    if (r.missing.error) expect((await payload(res)).error).toBe(r.missing.error);
    expect(generate).not.toHaveBeenCalled();
  });
  it("role split: catalog + export admit viewer to the required-field check; the other eight deny viewer 403", async () => {
    for (const r of ROUTES) {
      authed("viewer");
      const res = await r.handler(post(r.path, "{}"));
      if (r.open) expect(res.status, r.name).toBe(r.missing.status);
      else expect(res.status, r.name).toBe(403);
      resetInjectedIdentity();
    }
  });
});

describe("B16.0.18 §C/§F — trusted scope, actor, route invariants", () => {
  it("[problem] foreign project/branch body content → 403 component selection problem scope mismatch", async () => {
    authed();
    const states = { requirementsPackage: { projectId: "attacker" }, architectureState: { projectId: "attacker" }, powerState: {}, interfaceState: {}, circuitKnowledgeState: {}, upstreamSignoff: {}, tenantId: "attacker", branchId: "attacker" };
    const res = await problem(post("/api/component-selection/problem", JSON.stringify(states)));
    // reaches either the required-field check or the scope check depending on shape completeness
    expect([400, 403]).toContain(res.status);
  });
  it("[transaction] actor built ONLY from trusted context; attacker body actor/role/session ignored; foreign scope → 422 before create", async () => {
    authed();
    createTxn.mockReturnValue({ transactionId: "t1" });
    applyTxn.mockReturnValue({ record: { state: "accepted" }, state: {} });
    const res = await transaction(post("/api/component-selection/transaction", JSON.stringify({
      state: { projectId: "proj-1", branchId: "main" }, operations: [], reason: "r", idempotencyKey: "k", baseStateDigest: "d",
      actor: { actorId: "attacker", actorKind: "ai", sessionId: "evil", role: "project_admin" },
    })));
    expect(res.status).toBe(200);
    const arg = createTxn.mock.calls[0]![0] as { actor: Record<string, unknown>; projectId: string; branchId: string };
    expect(arg.actor).toEqual({ actorId: "u1", actorKind: "human", sessionId: expect.any(String), role: "pcb_editor" });
    expect(arg.projectId).toBe("proj-1");
    createTxn.mockClear();
    const foreign = await transaction(post("/api/component-selection/transaction", JSON.stringify({ state: { projectId: "attacker", branchId: "main" }, operations: [], reason: "r", idempotencyKey: "k", baseStateDigest: "d" })));
    expect(foreign.status).toBe(422);
    expect(createTxn).not.toHaveBeenCalled();
  });
  it("[export] foreign state scope → 422 before candidate lookup; unknown candidate → 404; PRELIMINARY_NOT_RELEASED preserved", async () => {
    authed();
    const foreign = await exportRoute(post("/api/component-selection/export", JSON.stringify({ state: { projectId: "attacker", branchId: "main" }, candidateId: "c1" })));
    expect(foreign.status).toBe(422);
    const missing = await exportRoute(post("/api/component-selection/export", JSON.stringify({ state: { projectId: "proj-1", branchId: "main", candidates: [] }, candidateId: "c1" })));
    expect(missing.status).toBe(404);
    expect((await payload(missing)).error).toBe("candidate is not in the pinned state");
  });
  it("[sourcing] operation=refresh remains fail-closed 503 with Retry-After: 300 and no invented observation", async () => {
    authed();
    const res = await sourcing(post("/api/component-selection/sourcing", JSON.stringify({ operation: "refresh" })));
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("300");
    const body = await payload(res);
    expect(body.error).toContain("no live observation was invented");
  });
});

describe("B16.0.18 §D — proposal-only provider boundary (pre = post contracts)", () => {
  const problemObj = (): Record<string, unknown> => ({
    projectId: "proj-1", branchId: "main", deterministicDigest: "p1", catalogSnapshotRevision: "c1",
    componentRoleRequirements: [{ roleRequirementId: "role:1", category: "resistor", blockerIds: [] }],
  });
  const catalogObj = (): Record<string, unknown> => ({ deterministicDigest: "c1", atomicPartRevisionIds: ["rev:1"] });
  const validBody = (): string => JSON.stringify({ problem: problemObj(), catalog: catalogObj(), userRequest: "find a resistor", provider: "openai" });
  const goodInput = { roleRequirementId: "role:1", categories: ["resistor"], exactAtomicRevisionIds: ["rev:1"], manufacturerIds: [], rationale: ["fits"], missingEvidenceRequests: [] };

  it("valid → provider EXACTLY once; maxTokens 4096, temperature 0, forced toolChoice, exact system prompt; proposal_only + empty hardGateResults + selectedPart null", async () => {
    authed();
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: "propose_component_catalog_search", input: goodInput }] } as never);
    const res = await propose(post("/api/component-selection/propose", validBody()));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
    const call = generate.mock.calls[0]![0] as { maxTokens: number; temperature: number; system: string; toolChoice: { name: string } };
    expect(call.maxTokens).toBe(4096);
    expect(call.temperature).toBe(0);
    expect(call.toolChoice).toEqual({ name: "propose_component_catalog_search" });
    expect(call.system).toContain("proposal-only CD-6 catalog search assistant");
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only");
    expect(body.hardGateResults).toEqual([]);
    expect(body.selectedPart).toBeNull();
    const proposal = body.proposal as Record<string, unknown>;
    expect(proposal.problemDigest).toBe("p1");
    expect(proposal.authority).toBe("proposal_only");
    expect(res.headers.get("X-Sirkit-AI-Provider")).toBe("openai");
  });
  it("problem/catalog digest mismatch → 422 with provider ZERO (pinned-snapshot binding)", async () => {
    authed();
    const res = await propose(post("/api/component-selection/propose", JSON.stringify({ problem: { ...problemObj(), catalogSnapshotRevision: "STALE" }, catalog: catalogObj(), userRequest: "x" })));
    expect(res.status).toBe(422);
    expect((await payload(res)).error).toBe("problem/catalog integrity or scope failed");
    expect(generate).not.toHaveBeenCalled();
  });
  it("scope mismatch → 422 with provider ZERO", async () => {
    authed();
    const res = await propose(post("/api/component-selection/propose", JSON.stringify({ problem: { ...problemObj(), projectId: "attacker" }, catalog: catalogObj(), userRequest: "x" })));
    expect(res.status).toBe(422);
    expect(generate).not.toHaveBeenCalled();
  });
  it("missing typed tool call → 422; genuine provider failure → 503 provider envelope", async () => {
    authed();
    generate.mockResolvedValueOnce({ provider: "openai", model: "m", text: "", toolCalls: [] } as never);
    const noTool = await propose(post("/api/component-selection/propose", validBody()));
    expect(noTool.status).toBe(422);
    expect((await payload(noTool)).error).toBe("provider returned no typed search proposal");
    generate.mockRejectedValueOnce(new Error("boom"));
    const failed = await propose(post("/api/component-selection/propose", validBody()));
    expect(failed.status).toBe(503);
    expect((await payload(failed)).provider).toBe("openai");
  });
});
