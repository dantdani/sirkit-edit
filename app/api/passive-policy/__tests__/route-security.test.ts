import { describe, expect, it, vi } from "vitest";
import { createPassivePolicyPostHandler } from "../handler";
import { InMemoryPassivePolicyRepository } from "@/app/lib/passive-policy/repository";
import { InMemoryPassivePolicyContextProvider } from "@/app/lib/passive-policy/providers";
import { PassivePolicyService } from "@/app/lib/passive-policy/service";
import { ScopedPassivePolicyInvalidationTarget } from "@/app/lib/passive-policy/invalidation";

const headers = { "content-type": "application/json", "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", "x-sirkit-actor-id": "admin-1", "x-sirkit-role": "project_admin" };
const service = new PassivePolicyService({ repository: new InMemoryPassivePolicyRepository(), contextProvider: new InMemoryPassivePolicyContextProvider(), invalidation: new ScopedPassivePolicyInvalidationTarget() });
function request(body: unknown, extra: Record<string, string> = {}) { return new Request("http://localhost/api/passive-policy", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify(body) }); }
const mutationHeaders = { "x-sirkit-passive-policy-mutation": "acknowledged" };
function authority() { return { tenantId: "tenant-1", projectId: "project-1", branchId: "main", componentInstanceId: "C1", variants: [{ assemblyVariantId: "variant-default", boardInstanceId: "board-1", componentSnapshotId: "component-snapshot-1", componentRevisionId: "component-r1", componentDigest: "component-digest-r1", stableComponentIdentityDigest: "component-identity-r1", contextDependencyDigest: "context-digest-r1" }], policyId: "project-passive-policy", approvedAgainstPolicyRevisionId: "policy-r1", approvedAgainstPolicyDigest: "policy-digest-r1", expectedPolicyRecordRevision: 4, assemblyProfileId: "assembly-standard", assemblyProfileRevisionId: "assembly-r1", assemblyProfileDigest: "assembly-digest-r1" }; }
function exception(action: "opt_out" | "assign_profile" = "opt_out") { return { exceptionContractVersion: "sirkit.passive-component-exception.v2", exceptionId: `exception-${action}`, componentInstanceId: "C1", assemblyVariantIds: ["variant-default"], action, selection: action === "assign_profile" ? { kind: "profile", profileId: "profile-0603", profileRevisionId: "profile-0603-r1", profileDigest: "profile-digest-r1", packageIdentityId: "package-0603", packageRevisionId: "package-0603-r1", footprintLogicalAssetId: "footprint-0603", footprintAssetVersionId: "footprint-0603-r1", footprintContentDigest: "footprint-digest-r1", mappingRevisionId: "mapping-r1", mappingContentDigest: "mapping-digest-r1", mappingResultDigest: "mapping-result-r1" } : { kind: "none" }, authority: authority(), evidenceRefs: ["decision-evidence-r1"] }; }
function mutation(operation: string, exceptionBody: unknown) { return { operation, requestId: `request-${operation}`, policyId: "project-passive-policy", recordId: "policy-record-4", expectedRevision: 4, expectedPolicyDigest: "policy-digest-r1", idempotencyKey: `key-${operation}`, reason: `Review ${operation}.`, exception: exceptionBody }; }

describe("passive policy API security", () => {
  it("is default-off and does not accept client-uploaded authoritative context", async () => {
    const handler = createPassivePolicyPostHandler(service, () => "off");
    expect((await handler(request({ operation: "evaluate", requestId: "r1", componentInstanceId: "C1", assemblyVariantId: "variant-default" }))).status).toBe(404);
    const forbidden = await handler(request({ operation: "evaluate", requestId: "r1", componentInstanceId: "C1", assemblyVariantId: "variant-default", mappingEvidence: { fake: true } }));
    expect(forbidden.status).toBe(400);
    expect((await forbidden.json()).code).toBe("PP_API_AUTHORITATIVE_INPUT_FORBIDDEN");
  });

  it("requires authentication and an explicit opt-in mutation acknowledgement", async () => {
    const handler = createPassivePolicyPostHandler(service, () => "observe");
    const unauthenticated = await handler(new Request("http://localhost/api/passive-policy", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(unauthenticated.status).toBe(401);
    const mutation = await handler(request({ operation: "publish", requestId: "r1", policyId: "project-passive-policy", expectedRevision: 1, idempotencyKey: "key-1", reason: "Publish" }));
    expect((await mutation.json()).code).toBe("PP_POLICY_MUTATION_NOT_ENABLED");
  });

  it("parses bounded approve/revoke/supersede operations and derives actor scope server-side", async () => {
    const applyApprovedException = vi.fn(async (_request: unknown) => ({ operation: "approved" })), revokeException = vi.fn(async (_request: unknown) => ({ operation: "revoked" })), supersedeException = vi.fn(async (_request: unknown) => ({ operation: "superseded" }));
    const handler = createPassivePolicyPostHandler({ applyApprovedException, revokeException, supersedeException } as unknown as PassivePolicyService, () => "opt_in");
    expect((await handler(request(mutation("approve_exception", exception()), mutationHeaders))).status).toBe(200);
    expect(applyApprovedException.mock.calls[0]![0]).toMatchObject({ tenantId: "tenant-1", projectId: "project-1", actorContext: { actorId: "admin-1", role: "project_admin" }, operation: "approve", exception: { state: "pending", createdBy: { actorId: "admin-1" } } });
    const revoke = mutation("revoke_exception", { exceptionId: "exception-opt_out", expectedDecisionRevision: 1, evidenceRefs: ["revoke-evidence-r1"] });
    expect((await handler(request(revoke, mutationHeaders))).status).toBe(200);
    expect(revokeException.mock.calls[0]![0]).toMatchObject({ operation: "revoke", expectedExceptionDecisionRevision: 1 });
    const supersede = mutation("supersede_exception", { predecessorExceptionId: "exception-opt_out", expectedDecisionRevision: 1, evidenceRefs: ["supersede-evidence-r1"], successor: exception("assign_profile") });
    expect((await handler(request(supersede, mutationHeaders))).status).toBe(200);
    expect(supersedeException.mock.calls[0]![0]).toMatchObject({ operation: "supersede", predecessorExceptionId: "exception-opt_out", exception: { action: "assign_profile" } });
  });

  it("rejects forged identity, unknown fields/actions, and maps stale exception revision safely", async () => {
    const revokeException = vi.fn(async (_request: unknown) => { throw new Error("PP_EXCEPTION_REVISION_CONFLICT"); }), handler = createPassivePolicyPostHandler({ revokeException } as unknown as PassivePolicyService, () => "opt_in");
    const forged = { ...mutation("approve_exception", exception()), actorContext: { actorId: "attacker", role: "project_admin" } };
    const forgedResponse = await handler(request(forged, mutationHeaders));
    expect(forgedResponse.status).toBe(400);
    expect((await forgedResponse.json()).code).toBe("PP_API_AUTHORITATIVE_INPUT_FORBIDDEN");
    const nestedForged = mutation("approve_exception", { ...exception(), createdBy: { actorId: "attacker" } }), nestedResponse = await handler(request(nestedForged, mutationHeaders));
    expect((await nestedResponse.json()).code).toBe("PP_API_UNKNOWN_FIELD");
    expect((await handler(request(mutation("delete_exception", {}), mutationHeaders))).status).toBe(400);
    const stale = await handler(request(mutation("revoke_exception", { exceptionId: "exception-opt_out", expectedDecisionRevision: 0, evidenceRefs: ["revoke-evidence-r1"] }), mutationHeaders));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("PP_EXCEPTION_REVISION_CONFLICT");
  });
});
