import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { ScopedMappingInvalidationTarget } from "@/app/lib/mapping-verification/invalidation";
import { InMemoryMappingContextProvider } from "@/app/lib/mapping-verification/providers";
import { InMemoryMappingRepository } from "@/app/lib/mapping-verification/repository";
import { MappingVerificationService } from "@/app/lib/mapping-verification/service";
import { InMemoryStage1MappingProjector } from "@/app/lib/mapping-verification/stage1-projector";
import { contextFixture, exactCandidate, request as verificationRequest } from "@/app/lib/mapping-verification/__tests__/fixtures";
import { createMappingPostHandler } from "../handler";

// B16.0.1: identity/role are SERVER-DERIVED via authorizeRequest — the
// x-sirkit-actor-id / x-sirkit-role identity headers are no longer read by any
// production route. Only the tenant/project/branch SELECTOR headers remain
// (never authority); the reviewer principal is injected through the auth test
// seams instead.
function selectorHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", ...extra };
}

function harness() {
  const context = contextFixture(), candidate = exactCandidate(context);
  const service = new MappingVerificationService({ provider: new InMemoryMappingContextProvider({ contexts: [context], candidates: [candidate] }), repository: new InMemoryMappingRepository(), stage1Projector: new InMemoryStage1MappingProjector(), invalidation: new ScopedMappingInvalidationTarget() });
  return { context, candidate, post: createMappingPostHandler(service, () => "observe") };
}

// B16.0.1: the reviewer role comes from active project MEMBERSHIP (membership
// role "reviewer" → project role reviewer, permitted by the REVIEW_EDITORS
// policy on POST /api/mapping-verification), never from a header.
beforeEach(() => { injectAuthorizedPrincipal({ userId: "reviewer-1", tenantId: "tenant-1", projectId: "project-1", role: "reviewer" }); });
afterEach(() => { resetInjectedIdentity(); });

describe("Stage 4 mapping API boundary", () => {
  it("verifies trusted server-side context without approving or changing a board", async () => {
    const { context, candidate, post } = harness();
    const response = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: selectorHeaders(), body: JSON.stringify({ operation: "verify", request: verificationRequest(context, candidate) }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, operation: "verify", readOnly: true, boardChanged: false, result: { status: "verified", claims: { approvesMapping: false, mutatesSchematic: false, mutatesPcb: false } } });
  });

  it("requires authenticated project scope and forbids client-uploaded authoritative assets", async () => {
    const { context, candidate, post } = harness();
    // B16.0.1: an unauthenticated session → 401. Identity can no longer be
    // asserted (or omitted) with x-sirkit-* headers — only a missing/invalid
    // server-verified principal is unauthenticated.
    injectIdentity(null);
    const unauthenticated = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "verify", request: verificationRequest(context, candidate) }) }));
    expect(unauthenticated.status).toBe(401);
    // B16.0.1: a viewer's ROLE comes from membership, never a header. POST
    // /api/mapping-verification permits REVIEW_EDITORS only, so an
    // authenticated viewer is refused with 403 before any service call — a
    // strictly stronger guarantee than the old header-role check.
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant-1", projectId: "project-1", role: "viewer" });
    const viewer = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: selectorHeaders(), body: JSON.stringify({ operation: "verify", request: verificationRequest(context, candidate) }) }));
    expect(viewer.status).toBe(403);
    expect(await viewer.json()).toMatchObject({ code: "AUTH_ROLE_DENIED" });
    // B16.0.1: the forbidden-authoritative-field refusal moved into the ONE
    // shared authorization adapter (scopedTrustedJson forbiddenBodyKeys),
    // which names it AUTH_AUTHORITATIVE_INPUT_FORBIDDEN — same 400 refusal,
    // shared code.
    injectAuthorizedPrincipal({ userId: "reviewer-1", tenantId: "tenant-1", projectId: "project-1", role: "reviewer" });
    const uploaded = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: selectorHeaders(), body: JSON.stringify({ operation: "verify", context: { forged: true }, request: verificationRequest(context, candidate) }) }));
    expect(uploaded.status).toBe(400);
    expect(await uploaded.json()).toMatchObject({ code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN" });
  });

  it("blocks lifecycle mutations in observe rollout even with an opt-in header", async () => {
    const { post } = harness();
    const response = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: selectorHeaders({ "x-sirkit-mapping-mutation-opt-in": "true" }), body: JSON.stringify({ operation: "approve", request: {} }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MV_MUTATION_ROLLOUT_BLOCKED" });
  });
});
