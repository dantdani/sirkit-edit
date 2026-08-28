/**
 * B16.0.17.1 §E — PERMANENT adversarial suite for the schematic-proposal
 * provider/local error boundary. Uses the REAL
 * `validateSchematicProposalToolInput` and REAL
 * `normalizeSchematicChangeProposal` (nothing spied in the validation path);
 * only `llmRouter.generate` and the domain problem/graph/project validators
 * are faked. No provider credits, network, or DB.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/schematic-compiler/problem", async (orig) => ({ ...(await orig() as object), validateSchematicCompilationProblem: vi.fn(() => []) }));
vi.mock("@/app/lib/schematic-compiler/graph", async (orig) => ({ ...(await orig() as object), validateSchematicGraph: vi.fn(() => ({ valid: true, diagnostics: [] })) }));
const createTxn = vi.hoisted(() => vi.fn());
const applyTxn = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/schematic-compiler/transactions", async (orig) => ({ ...(await orig() as object), createSchematicTransaction: createTxn, applySchematicTransaction: applyTxn }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);
import { POST as propose } from "../schematic-compiler/propose/route";
import { SCHEMATIC_PROPOSAL_TOOL, validateSchematicProposalToolInput } from "@/app/lib/schematic-compiler/agent-tools";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function req(body: string): Request {
  return new Request("http://localhost/api/schematic-compiler/propose", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
const authed = (): void => { injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" }); };

/** Full graph shape (every array normalize reads) with ONE known component. */
const graph = (): Record<string, unknown> => ({
  projectId: "proj-1", graphId: "graph:g1", deterministicDigest: "g1",
  components: [{ componentInstanceId: "component:known" }], units: [], pins: [], nets: [], endpoints: [], sheetInstances: [], portDefinitions: [], portBindings: [], bundleDefinitions: [],
});
const routeBody = (): string => JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, graph: graph(), userRequest: "propose", provider: "openai" });
/** A fixture derived from the DECLARED tool contract (schema-checked below). */
const validProposal = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  proposalKind: "connectivity",
  referencedSemanticObjectIds: ["component:known"],
  proposedActions: [{ actionKind: "connect_pin", targetObjectIds: ["component:known"], rationale: "Wire the known component" }],
  assumptions: [], warnings: [],
  ...over,
});
function toolCall(input: unknown): void {
  generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: SCHEMATIC_PROPOSAL_TOOL.name, input }] } as never);
}
/** The local-validation refusal contract: 422, deterministic local code, never
 *  a provider-availability classification, no proposal, no mutation channel,
 *  no transaction/apply, exactly one provider invocation. */
async function expectLocal422(res: Response, code: string): Promise<void> {
  expect(res.status).toBe(422);
  const body = await payload(res);
  expect(body.code).toBe(code);
  expect(body.proposal).toBeUndefined();
  expect(body.provider).toBeUndefined();   // not the providerErrorResponse envelope
  expect(body.retryable).toBeUndefined();  // not availability/quota/rate-limit
  expect(JSON.stringify(body)).not.toMatch(/graphMutation|diagramMutation|pcbMutation/);
  expect(generate).toHaveBeenCalledTimes(1);
  expect(createTxn).not.toHaveBeenCalled();
  expect(applyTxn).not.toHaveBeenCalled();
}

afterEach(() => { resetInjectedIdentity(); generate.mockReset(); createTxn.mockReset(); applyTxn.mockReset(); });

describe("B16.0.17.1 — the fixture honors the declared tool contract", () => {
  it("the valid fixture passes the REAL structural validator (single source of truth)", () => {
    expect(validateSchematicProposalToolInput(validProposal())).toEqual([]);
  });
});

describe("B16.0.17.1 §E — unknown semantic IDs (structurally valid payloads)", () => {
  it("1. unknown referencedSemanticObjectId → 422 CD8_AI_PROPOSAL_REFERENCE_INVALID", async () => {
    authed();
    toolCall(validProposal({ referencedSemanticObjectIds: ["component:unknown"] }));
    await expectLocal422(await propose(req(routeBody())), "CD8_AI_PROPOSAL_REFERENCE_INVALID");
  });
  it("2. unknown targetObjectId → 422 CD8_AI_PROPOSAL_REFERENCE_INVALID; graph byte-identical", async () => {
    authed();
    const g = graph();
    const frozen = JSON.stringify(g);
    toolCall({ ...validProposal(), proposedActions: [{ actionKind: "connect_pin", targetObjectIds: ["component:unknown"], rationale: "Attempt to reference an unknown semantic object" }] });
    const res = await propose(req(JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, graph: g, userRequest: "x", provider: "openai" })));
    await expectLocal422(res, "CD8_AI_PROPOSAL_REFERENCE_INVALID");
    expect(JSON.stringify(g)).toBe(frozen);
  });
  it("3./16. known semantic IDs SUCCEED — 200 proposal_only with digest-bound proposal + null mutations", async () => {
    authed();
    toolCall(validProposal());
    const res = await propose(req(routeBody()));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only");
    expect(body.graphMutation).toBeNull();
    expect(body.diagramMutation).toBeNull();
    expect(body.pcbMutation).toBeNull();
    const proposal = body.proposal as Record<string, unknown>;
    expect(proposal.problemDigest).toBe("p1");
    expect(proposal.graphDigest).toBe("g1");
    expect(proposal.authority).toBe("proposal_only");
    expect(typeof proposal.proposalId).toBe("string");
    expect(typeof proposal.deterministicDigest).toBe("string");
    expect(res.headers.get("X-Sirkit-AI-Provider")).toBe("openai");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("B16.0.17.1 §E — structurally malformed provider output → deterministic local 422", () => {
  const CASES: Array<[string, Record<string, unknown>]> = [
    ["4. missing referencedSemanticObjectIds", (() => { const p = validProposal(); delete p.referencedSemanticObjectIds; return p; })()],
    ["5. missing proposedActions", (() => { const p = validProposal(); delete p.proposedActions; return p; })()],
    ["6. missing assumptions", (() => { const p = validProposal(); delete p.assumptions; return p; })()],
    ["7. missing warnings", (() => { const p = validProposal(); delete p.warnings; return p; })()],
    ["8. wrong proposalKind", validProposal({ proposalKind: "world_domination" })],
    ["9. wrong actionKind", validProposal({ proposedActions: [{ actionKind: "drop_tables", targetObjectIds: ["component:known"], rationale: "x" }] })],
    ["10. targetObjectIds wrong type", validProposal({ proposedActions: [{ actionKind: "connect_pin", targetObjectIds: "component:known", rationale: "x" }] })],
    ["12a. oversized referenced array (513 items)", validProposal({ referencedSemanticObjectIds: Array.from({ length: 513 }, (_, index) => `id:${index}`) })],
    ["12b. oversized rationale (2001 chars)", validProposal({ proposedActions: [{ actionKind: "connect_pin", targetObjectIds: ["component:known"], rationale: "x".repeat(2001) }] })],
    ["extra: unexpected nested key", validProposal({ proposedActions: [{ actionKind: "connect_pin", targetObjectIds: ["component:known"], rationale: "x", surprise: true }] })],
    ["extra: original malformed B16.0.17 fixture (the §A counterexample)", { proposedActions: [{ targetSemanticIds: ["component:unknown"], referencedSemanticIds: [], rationale: "x" }] } as Record<string, unknown>],
  ];
  it.each(CASES)("%s → 422 SCHEMATIC_PROPOSAL_OUTPUT_INVALID (never a provider classification)", async (_label, input) => {
    authed();
    toolCall(input);
    await expectLocal422(await propose(req(routeBody())), "SCHEMATIC_PROPOSAL_OUTPUT_INVALID");
  });
  it("11. blank rationale (schema-passing whitespace) → 422 CD8_AI_PROPOSAL_REFERENCE_INVALID via normalize's trim check", async () => {
    authed();
    toolCall(validProposal({ proposedActions: [{ actionKind: "connect_pin", targetObjectIds: ["component:known"], rationale: " " }] }));
    await expectLocal422(await propose(req(routeBody())), "CD8_AI_PROPOSAL_REFERENCE_INVALID");
  });
});

describe("B16.0.17.1 §E — provider failures stay on the provider boundary", () => {
  it("13. missing typed tool call → historical 422 (no local code, no provider envelope)", async () => {
    authed();
    generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [] } as never);
    const res = await propose(req(routeBody()));
    expect(res.status).toBe(422);
    expect((await payload(res)).error).toBe("provider returned no typed schematic proposal");
  });
  it("14./15. genuine provider rejection (incl. quota/timeout-style) → 503 providerErrorResponse, NEVER a local validation code", async () => {
    authed();
    for (const boom of [new Error("boom"), Object.assign(new Error("insufficient_quota"), { status: 429 })]) {
      generate.mockRejectedValueOnce(boom);
      const res = await propose(req(routeBody()));
      expect(res.status).toBe(503);
      const body = await payload(res);
      expect(body.provider).toBe("openai"); // the provider envelope
      expect(body.code).not.toBe("SCHEMATIC_PROPOSAL_OUTPUT_INVALID");
      expect(body.code).not.toBe("CD8_AI_PROPOSAL_REFERENCE_INVALID");
    }
  });
  it("boundary refusal (unauthenticated) → 401 with ZERO provider invocations", async () => {
    const { injectIdentity } = await import("@/app/lib/auth/test-support");
    injectIdentity(null);
    const res = await propose(req(routeBody()));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
});
