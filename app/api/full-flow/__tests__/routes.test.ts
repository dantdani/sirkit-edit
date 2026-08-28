import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as createRun } from "../run/route";
import { POST as propose } from "../propose/route";
import { POST as transition } from "../transition/route";
// B16.0.1: identity/role/actor-kind are SERVER-DERIVED (authorizeRequest + trusted request context).
// The x-sirkit-tenant/project/branch headers below are a project SELECTOR only — the old
// x-sirkit-actor-id / x-sirkit-role / x-sirkit-actor-kind identity headers are never read.
// The "origin" header makes each request a legitimate same-origin mutation under the
// automatic CSRF rule for non-GET methods.
const headers = { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "tenant:test", "x-sirkit-project-id": "project:test", "x-sirkit-branch-id": "branch:test" };
const transitionBody = JSON.stringify({ run: {}, expectedStateDigest: "state", to: "planning", payloadDigest: "payload" });
const transitionRequest = (requestHeaders: Record<string, string>) => new Request("http://localhost/api/full-flow/transition", { method: "POST", headers: requestHeaders, body: transitionBody });
beforeEach(() => { injectAuthorizedPrincipal({ userId: "engineer:test", tenantId: "tenant:test", projectId: "project:test", role: "admin" }); });
afterEach(() => { resetInjectedIdentity(); });
describe("CD-13 API authority and prerequisite behavior", () => {
  it("creates a durable draft run while reporting the implementation CD-12 blocker", async () => { const response = await createRun(new Request("http://localhost/api/full-flow/run", { method: "POST", headers, body: JSON.stringify({ requestedOutcome: "routed_pcb_candidate", productBriefRef: "brief:1", productBriefDigest: "sha256:brief", autonomyTier: 2 }) })); expect(response.status).toBe(201); const body = await response.json(); expect(body.run.lifecycleState).toBe("created"); expect(body.implementationPrerequisite.verdict).toBe("BLOCKED BY CD-12"); expect(body.authoritativeEngineeringArtifactsCreated).toBe(false); });
  // B16.0.1: the old x-sirkit-actor-kind:"ai" header is ignored — the proposal is recorded
  // against the server-derived (human) principal, and its authority stays proposal_only.
  it("accepts narrow AI proposals with no direct commit or side effect", async () => { const response = await propose(new Request("http://localhost/api/full-flow/propose", { method: "POST", headers, body: JSON.stringify({ runRef: "run:1", stateDigest: "state:1", kind: "stage_evaluation", targetRefs: ["candidate:1"], typedPayload: { stage: "CD-7" }, rationale: "close analytical uncertainty", evidenceRefs: ["finding:1"] }) })); expect(response.status).toBe(200); const body = await response.json(); expect(body.proposal.authority).toBe("proposal_only"); expect(body.externalSideEffects).toBe(false); });
  // B16.0.1: the old assertion ("x-sirkit-actor-kind: ai" header → 403) relied on
  // caller-asserted identity that no longer exists. The equivalent-or-stronger property is
  // server-derived: an LLM cannot present as an authenticated session principal at all
  // (unauthenticated → 401), and a member outside REVIEW_EDITORS cannot commit a
  // transition (→ 403 AUTH_ROLE_DENIED) — both refused BEFORE the malformed run body is
  // parsed, and spoofed x-sirkit identity headers grant nothing.
  it("rejects unauthenticated and under-privileged transition commits before parsing a run mutation, ignoring spoofed identity headers", async () => {
    const spoofed = { ...headers, "x-sirkit-actor-id": "engineer:test", "x-sirkit-role": "project_admin", "x-sirkit-actor-kind": "ai" };
    injectIdentity(null);
    const unauthenticated = await transitionRequestResponse(spoofed);
    expect(unauthenticated.status).toBe(401);
    expect((await unauthenticated.json()).code).toBe("AUTH_UNAUTHENTICATED");
    injectAuthorizedPrincipal({ userId: "viewer:test", tenantId: "tenant:test", projectId: "project:test", role: "viewer" });
    const denied = await transitionRequestResponse(spoofed);
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("AUTH_ROLE_DENIED");
  });
  // B16.0.1: with header-asserted "ai" gone, an authorized reviewer/admin's malformed run
  // body now reaches the integrity validator — it must refuse with a typed 409
  // (fail-closed, no commit), never crash the handler with an unhandled TypeError.
  it("refuses a structurally malformed run with a typed 409 and commits nothing", async () => {
    const response = await transitionRequestResponse(headers);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("run integrity invalid");
    expect(body.diagnostics).toContain("CD13_RUN_SHAPE_INVALID");
  });
});
function transitionRequestResponse(requestHeaders: Record<string, string>): Promise<Response> { return transition(transitionRequest(requestHeaders)); }
