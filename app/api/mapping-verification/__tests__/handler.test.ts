import { describe, expect, it } from "vitest";
import { ScopedMappingInvalidationTarget } from "@/app/lib/mapping-verification/invalidation";
import { InMemoryMappingContextProvider } from "@/app/lib/mapping-verification/providers";
import { InMemoryMappingRepository } from "@/app/lib/mapping-verification/repository";
import { MappingVerificationService } from "@/app/lib/mapping-verification/service";
import { InMemoryStage1MappingProjector } from "@/app/lib/mapping-verification/stage1-projector";
import { contextFixture, exactCandidate, request as verificationRequest } from "@/app/lib/mapping-verification/__tests__/fixtures";
import { createMappingPostHandler } from "../handler";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "content-type": "application/json", "x-sirkit-tenant-id": "tenant-1", "x-sirkit-project-id": "project-1", "x-sirkit-branch-id": "main", "x-sirkit-actor-id": "reviewer-1", "x-sirkit-role": "reviewer", ...extra };
}

function harness() {
  const context = contextFixture(), candidate = exactCandidate(context);
  const service = new MappingVerificationService({ provider: new InMemoryMappingContextProvider({ contexts: [context], candidates: [candidate] }), repository: new InMemoryMappingRepository(), stage1Projector: new InMemoryStage1MappingProjector(), invalidation: new ScopedMappingInvalidationTarget() });
  return { context, candidate, post: createMappingPostHandler(service, () => "observe") };
}

describe("Stage 4 mapping API boundary", () => {
  it("verifies trusted server-side context without approving or changing a board", async () => {
    const { context, candidate, post } = harness();
    const response = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: authHeaders(), body: JSON.stringify({ operation: "verify", request: verificationRequest(context, candidate) }) }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, operation: "verify", readOnly: true, boardChanged: false, result: { status: "verified", claims: { approvesMapping: false, mutatesSchematic: false, mutatesPcb: false } } });
  });

  it("requires authenticated project scope and forbids client-uploaded authoritative assets", async () => {
    const { context, candidate, post } = harness();
    const unauthenticated = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "verify", request: verificationRequest(context, candidate) }) }));
    expect(unauthenticated.status).toBe(401);
    const uploaded = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: authHeaders(), body: JSON.stringify({ operation: "verify", context: { forged: true }, request: verificationRequest(context, candidate) }) }));
    expect(uploaded.status).toBe(400);
    expect(await uploaded.json()).toMatchObject({ code: "MV_API_AUTHORITATIVE_INPUT_FORBIDDEN" });
  });

  it("blocks lifecycle mutations in observe rollout even with an opt-in header", async () => {
    const { post } = harness();
    const response = await post(new Request("http://localhost/api/mapping-verification", { method: "POST", headers: authHeaders({ "x-sirkit-mapping-mutation-opt-in": "true" }), body: JSON.stringify({ operation: "approve", request: {} }) }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MV_MUTATION_ROLLOUT_BLOCKED" });
  });
});
