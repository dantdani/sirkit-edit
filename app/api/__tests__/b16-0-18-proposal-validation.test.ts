/**
 * B16.0.18 §E — PERMANENT adversarial suite for the component-selection
 * proposal provider/local error boundary (the B16.0.17.1/.2 lesson applied
 * during the stage). REAL `validateComponentSearchProposalToolInput` and REAL
 * `createCatalogSearchProposal`; only `llmRouter.generate` and the domain
 * problem/catalog validators are faked. Zero credits/network/DB.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/component-selection/problem", async (orig) => ({ ...(await orig() as object), validateComponentSelectionProblem: vi.fn(() => []) }));
vi.mock("@/app/lib/component-selection/catalog", async (orig) => ({ ...(await orig() as object), validateEngineeringCatalogSnapshot: vi.fn(() => []) }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);
import { POST as propose } from "../component-selection/propose/route";
import { COMPONENT_SEARCH_PROPOSAL_TOOL, validateComponentSearchProposalToolInput } from "@/app/lib/component-selection/agent-tools";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function req(body: string): Request {
  return new Request("http://localhost/api/component-selection/propose", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
const authed = (): void => { injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" }); };

const P = COMPONENT_SEARCH_PROPOSAL_TOOL.schema.properties;
const routeBody = (): string => JSON.stringify({
  problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1", catalogSnapshotRevision: "c1", componentRoleRequirements: [{ roleRequirementId: "role:1", category: "resistor", blockerIds: [] }] },
  catalog: { deterministicDigest: "c1", atomicPartRevisionIds: ["rev:1"] },
  userRequest: "find a resistor", provider: "openai",
});
const validInput = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  roleRequirementId: "role:1", categories: ["resistor"], exactAtomicRevisionIds: ["rev:1"], manufacturerIds: [], rationale: ["fits"], missingEvidenceRequests: [],
  ...over,
});
function toolCall(input: unknown): void {
  generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: COMPONENT_SEARCH_PROPOSAL_TOOL.name, input }] } as never);
}
async function expectLocal422(res: Response, code: string): Promise<void> {
  expect(res.status).toBe(422);
  const body = await payload(res);
  expect(body.code).toBe(code);
  expect(body.proposal).toBeUndefined();
  expect(body.provider).toBeUndefined();   // not the provider envelope
  expect(body.retryable).toBeUndefined();  // not availability/quota/rate-limit
  expect(generate).toHaveBeenCalledTimes(1);
}

afterEach(() => { resetInjectedIdentity(); generate.mockReset(); });

describe("B16.0.18 §E — the fixture honors the declared tool contract (no drift)", () => {
  it("the valid fixture passes the REAL schema-derived structural validator", () => {
    expect(validateComponentSearchProposalToolInput(validInput())).toEqual([]);
  });
  it("schema boundaries agree with the validator (data-driven from the nodes)", () => {
    // roleRequirementId maxLength
    expect(validateComponentSearchProposalToolInput(validInput({ roleRequirementId: "x".repeat(P.roleRequirementId.maxLength) }))).toEqual([]);
    expect(validateComponentSearchProposalToolInput(validInput({ roleRequirementId: "x".repeat(P.roleRequirementId.maxLength + 1) }))).not.toEqual([]);
    // every string-array node: at items.maxLength ok, over refused; at maxItems ok, over refused
    for (const field of ["categories", "exactAtomicRevisionIds", "manufacturerIds", "rationale", "missingEvidenceRequests"] as const) {
      const node = P[field];
      expect(validateComponentSearchProposalToolInput(validInput({ [field]: ["x".repeat(node.items.maxLength)] })), `${field} at maxLength`).toEqual([]);
      expect(validateComponentSearchProposalToolInput(validInput({ [field]: ["x".repeat(node.items.maxLength + 1)] })), `${field} over maxLength`).not.toEqual([]);
      const fill = (n: number): string[] => Array.from({ length: n }, (_, index) => `v${index}`);
      expect(validateComponentSearchProposalToolInput(validInput({ [field]: fill(node.maxItems) })), `${field} at maxItems`).toEqual([]);
      expect(validateComponentSearchProposalToolInput(validInput({ [field]: fill(node.maxItems + 1) })), `${field} over maxItems`).not.toEqual([]);
    }
    // required fields (iterated from the schema's own required array)
    for (const field of COMPONENT_SEARCH_PROPOSAL_TOOL.schema.required) {
      const broken = validInput();
      delete broken[field];
      expect(validateComponentSearchProposalToolInput(broken), `missing ${field}`).not.toEqual([]);
    }
    // additionalProperties: false
    expect(validateComponentSearchProposalToolInput(validInput({ surprise: 1 }))).not.toEqual([]);
  });
});

describe("B16.0.18 §E — malformed provider output → deterministic local 422", () => {
  const CASES: Array<[string, unknown]> = [
    ["missing categories", (() => { const p = validInput(); delete p.categories; return p; })()],
    ["categories wrong type", validInput({ categories: "resistor" })],
    ["unexpected key", validInput({ selectedPart: "evil" })],
    ["non-object input", "not an object"],
    ["oversized rationale item", validInput({ rationale: ["x".repeat(P.rationale.items.maxLength + 1)] })],
  ];
  it.each(CASES)("%s → 422 COMPONENT_PROPOSAL_OUTPUT_INVALID (never a provider classification)", async (_label, input) => {
    authed();
    toolCall(input);
    await expectLocal422(await propose(req(routeBody())), "COMPONENT_PROPOSAL_OUTPUT_INVALID");
  });
});

describe("B16.0.18 §E — unpinned semantic references → deterministic local 422 with the exact CD6 code", () => {
  it("unpinned roleRequirementId → 422 CD6_AGENT_ROLE_OUT_OF_SCOPE", async () => {
    authed();
    toolCall(validInput({ roleRequirementId: "role:UNPINNED" }));
    await expectLocal422(await propose(req(routeBody())), "CD6_AGENT_ROLE_OUT_OF_SCOPE");
  });
  it("atomic revision outside the pinned snapshot → 422 CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT", async () => {
    authed();
    toolCall(validInput({ exactAtomicRevisionIds: ["rev:UNPINNED"] }));
    await expectLocal422(await propose(req(routeBody())), "CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT");
  });
  it("valid pinned proposal SUCCEEDS — proposal_only, empty hardGateResults, selectedPart null, digest-bound", async () => {
    authed();
    toolCall(validInput());
    const res = await propose(req(routeBody()));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only");
    expect(body.hardGateResults).toEqual([]);
    expect(body.selectedPart).toBeNull();
    const proposal = body.proposal as Record<string, unknown>;
    expect(proposal.problemDigest).toBe("p1");
    expect(typeof proposal.deterministicDigest).toBe("string");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("B16.0.18 §E — provider failures stay on the provider boundary", () => {
  it("provider rejection (incl. quota-style) → 503 provider envelope, never a local code", async () => {
    authed();
    for (const boom of [new Error("boom"), Object.assign(new Error("insufficient_quota"), { status: 429 })]) {
      generate.mockRejectedValueOnce(boom);
      const res = await propose(req(routeBody()));
      expect(res.status).toBe(503);
      const body = await payload(res);
      expect(body.provider).toBe("openai");
      expect(body.code).not.toBe("COMPONENT_PROPOSAL_OUTPUT_INVALID");
      expect(String(body.code)).not.toMatch(/^CD6_/);
    }
  });
  it("boundary refusal (unauthenticated) → 401 with ZERO provider invocations", async () => {
    injectIdentity(null);
    const res = await propose(req(routeBody()));
    expect(res.status).toBe(401);
    expect(generate).not.toHaveBeenCalled();
  });
});
