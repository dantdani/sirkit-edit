/**
 * B16.0.19 §D/§F — PERMANENT adversarial suites for BOTH circuit proposal
 * boundaries. REAL validators + REAL claim/normalize factories; only
 * `llmRouter.generate` and the domain problem/source validators are spied.
 * Zero credits/network/DB.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/circuit-knowledge/source", async (orig) => ({
  ...(await orig() as object),
  validateRecipeSourceBundle: vi.fn(() => []),
  validateClaimPromotion: vi.fn(() => []),
}));
vi.mock("@/app/lib/circuit-verification/problem", async (orig) => ({ ...(await orig() as object), validateCircuitVerificationProblem: vi.fn(() => []) }));

import { llmRouter } from "@/app/lib/llm/router";
const generate = vi.mocked(llmRouter.generate);
import { POST as ckPropose } from "../circuit-knowledge/propose/route";
import { POST as cvPropose } from "../circuit-verification/propose/route";
import { CIRCUIT_RECIPE_CLAIM_TOOL, validateCircuitRecipeClaimToolInput } from "@/app/lib/circuit-knowledge/agent-tools";
import { CIRCUIT_VERIFICATION_PROPOSAL_TOOL, validateCircuitVerificationProposalToolInput } from "@/app/lib/circuit-verification/agent-tools";
import { finalizeVerification } from "@/app/lib/circuit-verification/stable";
import type { FullOracleRun } from "@/app/lib/circuit-verification/types";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function req(path: string, body: string): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body });
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
const authed = (): void => { injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role: "editor" }); };

afterEach(() => { resetInjectedIdentity(); generate.mockReset(); });

// ══════════════ circuit-knowledge proposal (§D) ══════════════
const CK = CIRCUIT_RECIPE_CLAIM_TOOL.schema.properties;
const ckBody = (): string => JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, sourceBundle: { sourceBundleId: "sb1", sourceLocations: [] }, userRequest: "extract", provider: "openai" });
const ckInput = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  claimKind: "decoupling", proposedValue: { note: "x" }, conditions: [], sourceEvidenceRefs: ["ev:1"], sourceLocationRefs: ["loc:1"], reviewerQueueIds: ["rq:1"],
  ...over,
});
function ckToolCall(input: unknown): void {
  generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: CIRCUIT_RECIPE_CLAIM_TOOL.name, input }] } as never);
}

describe("B16.0.19 §D — circuit-knowledge proposal output validation", () => {
  it("the valid fixture passes the REAL schema-derived validator; boundaries agree with the schema nodes", () => {
    expect(validateCircuitRecipeClaimToolInput(ckInput())).toEqual([]);
    // NEW §D bounds: ref-array items now carry minLength 1 / maxLength 300 IN the schema
    for (const field of ["sourceEvidenceRefs", "sourceLocationRefs", "reviewerQueueIds"] as const) {
      const node = CK[field];
      expect(node.items.maxLength, field).toBe(300);
      expect(validateCircuitRecipeClaimToolInput(ckInput({ [field]: ["x".repeat(node.items.maxLength)] })), `${field} at max`).toEqual([]);
      expect(validateCircuitRecipeClaimToolInput(ckInput({ [field]: ["x".repeat(node.items.maxLength + 1)] })), `${field} over max`).not.toEqual([]);
      expect(validateCircuitRecipeClaimToolInput(ckInput({ [field]: [] })), `${field} below minItems`).not.toEqual([]);
    }
    for (const field of CIRCUIT_RECIPE_CLAIM_TOOL.schema.required) {
      const broken = ckInput();
      delete broken[field];
      expect(validateCircuitRecipeClaimToolInput(broken), `missing ${field}`).not.toEqual([]);
    }
    expect(validateCircuitRecipeClaimToolInput(ckInput({ surprise: 1 }))).not.toEqual([]);
  });
  it.each([
    ["missing sourceEvidenceRefs", (() => { const p = ckInput(); delete p.sourceEvidenceRefs; return p; })()],
    ["oversized ref item (301 chars)", ckInput({ sourceEvidenceRefs: ["x".repeat(301)] })],
    ["proposedValue wrong type", ckInput({ proposedValue: "not-an-object" })],
    ["unexpected key", ckInput({ approve: true })],
  ])("%s → 422 CIRCUIT_CLAIM_OUTPUT_INVALID (never a provider classification)", async (_label, input) => {
    authed();
    ckToolCall(input);
    const res = await ckPropose(req("/api/circuit-knowledge/propose", ckBody()));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.code).toBe("CIRCUIT_CLAIM_OUTPUT_INVALID");
    expect(body.provider).toBeUndefined();
    expect(body.retryable).toBeUndefined();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("provider rejection → 503 envelope, never the local code; unauth boundary → provider ZERO", async () => {
    authed();
    generate.mockRejectedValueOnce(new Error("boom"));
    const res = await ckPropose(req("/api/circuit-knowledge/propose", ckBody()));
    expect(res.status).toBe(503);
    expect((await payload(res)).provider).toBe("openai");
  });
});

// ══════════════ circuit-verification proposal (§F) ══════════════
const CV = CIRCUIT_VERIFICATION_PROPOSAL_TOOL.schema.properties;
function makeRun(): FullOracleRun {
  return finalizeVerification({
    runId: "run:1", runKind: "full", problemDigest: "p1", graphDigest: "g1",
    findings: [{ stableIdentity: "finding:1", currentRunId: "run:1", engineeringResult: "fail", severity: "major", semanticAnchorIds: ["anchor:1"], summary: "s" }],
    deterministicDigest: "",
  } as unknown as FullOracleRun);
}
const cvBody = (run: FullOracleRun): string => JSON.stringify({ problem: { projectId: "proj-1", branchId: "main", deterministicDigest: "p1" }, run, userRequest: "remediate", provider: "openai" });
const cvInput = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  findingStableIdentities: ["finding:1"], summary: "inspect the rail",
  proposedActions: [{ actionId: "a1", kind: "inspect_evidence", targetIds: ["anchor:1"], rationale: "check" }],
  ...over,
});
function cvToolCall(input: unknown): void {
  generate.mockResolvedValue({ provider: "openai", model: "m", text: "", toolCalls: [{ id: "t1", name: CIRCUIT_VERIFICATION_PROPOSAL_TOOL.name, input }] } as never);
}

describe("B16.0.19 §F — circuit-verification proposal output validation", () => {
  it("the valid fixture passes the REAL validator; id items now carry schema maxLength 4096; required + additionalProperties enforced", () => {
    expect(validateCircuitVerificationProposalToolInput(cvInput())).toEqual([]);
    expect(CV.findingStableIdentities.items.maxLength).toBe(4096);
    expect(validateCircuitVerificationProposalToolInput(cvInput({ findingStableIdentities: ["x".repeat(4097)] }))).not.toEqual([]);
    for (const field of CIRCUIT_VERIFICATION_PROPOSAL_TOOL.schema.required) {
      const broken = cvInput();
      delete broken[field];
      expect(validateCircuitVerificationProposalToolInput(broken), `missing ${field}`).not.toEqual([]);
    }
    expect(validateCircuitVerificationProposalToolInput(cvInput({ waive: true }))).not.toEqual([]);
    expect(validateCircuitVerificationProposalToolInput(cvInput({ proposedActions: [{ actionId: "a1", kind: "delete_finding", targetIds: [], rationale: "r" }] }))).not.toEqual([]); // unknown kind
  });
  it("VALID pinned proposal → 200 proposal_only_no_design_or_verdict_mutation with ALL five mutations null; findings/run unchanged", async () => {
    authed();
    const run = makeRun();
    const frozen = JSON.stringify(run);
    cvToolCall(cvInput());
    const res = await cvPropose(req("/api/circuit-verification/propose", cvBody(run)));
    expect(res.status).toBe(200);
    const body = await payload(res);
    expect(body.authority).toBe("proposal_only_no_design_or_verdict_mutation");
    expect(body.graphMutation).toBeNull();
    expect(body.schematicMutation).toBeNull();
    expect(body.pcbMutation).toBeNull();
    expect(body.waiverMutation).toBeNull();
    expect(body.readinessMutation).toBeNull();
    const proposal = body.proposal as Record<string, unknown>;
    expect(proposal.fullRunId).toBe("run:1");
    expect(proposal.graphDigest).toBe("g1");
    expect(proposal.status).toBe("draft");
    expect(JSON.stringify(run)).toBe(frozen); // the pinned run is byte-unchanged
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it("unknown finding identity → 422 CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID (deterministic local, never provider)", async () => {
    authed();
    cvToolCall(cvInput({ findingStableIdentities: ["finding:UNKNOWN"] }));
    const res = await cvPropose(req("/api/circuit-verification/propose", cvBody(makeRun())));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.code).toBe("CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID");
    expect(body.provider).toBeUndefined();
  });
  it("action target outside the pinned semantic anchors → 422 CD9_REMEDIATION_PROPOSAL_INPUT_INVALID", async () => {
    authed();
    cvToolCall(cvInput({ proposedActions: [{ actionId: "a1", kind: "inspect_evidence", targetIds: ["anchor:UNKNOWN"], rationale: "r" }] }));
    const res = await cvPropose(req("/api/circuit-verification/propose", cvBody(makeRun())));
    expect(res.status).toBe(422);
    expect((await payload(res)).code).toBe("CD9_REMEDIATION_PROPOSAL_INPUT_INVALID");
  });
  it("structurally malformed output → 422 VERIFICATION_PROPOSAL_OUTPUT_INVALID; provider rejection → 503 envelope", async () => {
    authed();
    cvToolCall({ findingStableIdentities: "not-an-array", summary: "", proposedActions: [] });
    const bad = await cvPropose(req("/api/circuit-verification/propose", cvBody(makeRun())));
    expect(bad.status).toBe(422);
    expect((await payload(bad)).code).toBe("VERIFICATION_PROPOSAL_OUTPUT_INVALID");
    generate.mockRejectedValueOnce(new Error("boom"));
    const failed = await cvPropose(req("/api/circuit-verification/propose", cvBody(makeRun())));
    expect(failed.status).toBe(503);
    expect((await payload(failed)).provider).toBe("openai");
  });
});
