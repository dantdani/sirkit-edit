import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { databaseQualification, withQualifiedDatabase } from "@/app/lib/db/test-qualification";

vi.mock("@/app/lib/footprint-resolver/__tests__/fixtures", async () => {
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("@/app/lib/physical-binding/repository");
  const { createApprovedValidation } = await import("@/app/lib/physical-binding/transitions");
  const { ACTOR, exactCandidate, transition } = await import("@/app/lib/physical-binding/__tests__/fixtures");
  return { readyRepository: async (componentId = "resolver-ready") => {
    const repository = new InMemoryPhysicalBindingRepository(), service = new PhysicalBindingService(repository), candidate = exactCandidate(componentId);
    let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = transition(candidate, state.set.revision, "select", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "revalidate", ACTOR);
    request.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: request.at, evidenceRefs: ["evidence-mapping"] });
    state = await service.transition(state.set.setId, request);
    current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    request = transition(current, state.set.revision, "approve", ACTOR);
    request.decisionEvidenceRefs = ["evidence-datasheet"];
    state = await service.transition(state.set.setId, request);
    return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! };
  } };
});
import { createPcbSyncBoardGetHandler, createPcbSyncPostHandler } from "../handler";
import { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { applyRequest, preflightRequest, readyHarness as baseReadyHarness } from "@/app/lib/pcb-sync/__tests__/fixtures";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, type PcbSyncDemoSnapshotPublicationRequest } from "@/app/lib/pcb-sync/types";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";

const APPLY_AT = "2026-07-19T12:01:00.000Z";

// B16.0: identity/role are SERVER-DERIVED. Inject a deterministic authorized
// principal (userId "human-1", project admin on tenant-1/project-1) so the
// happy-path tests observe a known actorId; individual tests override this to
// exercise unauthenticated / insufficient-role paths.
beforeEach(() => { injectAuthorizedPrincipal({ userId: "human-1", tenantId: "tenant-1", projectId: "project-1", role: "admin" }); });
afterEach(() => { resetInjectedIdentity(); });

async function readyHarness(applyAt = APPLY_AT) {
  const harness = await baseReadyHarness();
  const service = new PcbSynchronizationService({ snapshotProvider: harness.snapshotProvider, resolver: harness.resolver, resourceProvider: harness.resourceProvider, repository: harness.repository, clock: () => applyAt });
  return { ...harness, service };
}

const headers = {
  "content-type": "application/json",
  "x-sirkit-tenant-id": "tenant-1",
  "x-sirkit-project-id": "project-1",
  "x-sirkit-branch-id": "main",
  "x-sirkit-actor-id": "human-1",
  "x-sirkit-role": "pcb_editor",
  "x-sirkit-session-id": "api-test",
};

function post(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/pcb-sync", { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });
}

function get(boardId: string, extraHeaders: Record<string, string> = {}, query = "") {
  return new Request(`http://localhost/api/pcb-sync?boardId=${encodeURIComponent(boardId)}${query}`, { headers: { ...headers, ...extraHeaders } });
}

function publicationRequest(source: Awaited<ReturnType<typeof baseReadyHarness>>, input: Partial<PcbSyncDemoSnapshotPublicationRequest> = {}): PcbSyncDemoSnapshotPublicationRequest {
  const snapshot = source.snapshot;
  return { requestSchemaVersion: PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, requestId: "publish-demo-1", designId: snapshot.designId, boardId: "board-1", boardName: "Main Board", projectRevision: snapshot.projectRevision, designRevision: snapshot.designRevision, schematicRevision: snapshot.schematicRevision, componentSetRevision: snapshot.componentSetRevision, netGraphRevision: snapshot.netGraphRevision, assemblyVariantId: snapshot.assemblyVariantId, assemblyVariantRevision: snapshot.assemblyVariantRevision, librarySnapshotRevision: snapshot.librarySnapshotRevision, components: structuredClone(snapshot.components), nets: structuredClone(snapshot.nets), prerequisiteIssues: structuredClone(snapshot.prerequisiteIssues), expectedSnapshotRevision: 0, idempotencyKey: "publish-demo-key-1", requestedAt: "2026-07-19T11:59:00.000Z", ...input };
}

async function durableApiHarness(workflow: DurableWorkflowRepository = new InMemoryDurableWorkflowRepository()) {
  const source = await baseReadyHarness(), snapshots = new DurablePcbSyncSnapshotStore(workflow), repository = new DurablePcbSyncRepository(workflow);
  const service = new PcbSynchronizationService({ snapshotProvider: snapshots, resolver: source.resolver, resourceProvider: source.resourceProvider, repository, clock: () => APPLY_AT });
  const postHandler = createPcbSyncPostHandler(service, () => "opt_in", { snapshotPublisher: snapshots, repository, clock: () => "2026-07-19T11:59:30.000Z" }), getHandler = createPcbSyncBoardGetHandler(repository, () => "opt_in");
  return { source, snapshots, repository, workflow, service, postHandler, getHandler };
}

async function exerciseReadyFlow(workflow: DurableWorkflowRepository) {
  const harness = await durableApiHarness(workflow), publication = publicationRequest(harness.source);
  const publishedResponse = await harness.postHandler(post({ operation: "publish_demo_snapshot", request: publication })), published = await publishedResponse.json();
  expect(publishedResponse.status).toBe(201);
  const preflightResponse = await harness.postHandler(post({ operation: "preflight", request: preflightRequest() })), preflight = await preflightResponse.json();
  if (preflightResponse.status !== 200) {
    let direct = "no direct error";
    try { await harness.service.preflight(preflightRequest({ requestId: "diagnostic-preflight" })); } catch (error) { direct = error instanceof Error ? error.message : String(error); }
    throw new Error(`U01_PREFLIGHT_API_${preflightResponse.status}:${JSON.stringify(preflight)}; DIRECT:${direct}`);
  }
  expect(preflight.result).toMatchObject({ status: "ready_to_apply", plan: { lifecycle: "applicable" } });
  const applyResponse = await harness.postHandler(post({ operation: "apply", request: applyRequest(preflight.result.plan) }, { "x-sirkit-pcb-sync-opt-in": "true" })), applied = await applyResponse.json();
  expect(applied.result.status).toBe("applied");
  const loadResponse = await harness.getHandler(get("board-1")), loaded = await loadResponse.json();
  expect(loaded.result).toMatchObject({ status: "found", record: { revision: applied.result.committedBoardRevision, digest: applied.result.committedBoardDigest } });
  const restartedRepository = new DurablePcbSyncRepository(workflow), restarted = createPcbSyncBoardGetHandler(restartedRepository, () => "opt_in"), reloaded = await (await restarted(get("board-1"))).json();
  expect(reloaded.result.record).toEqual(loaded.result.record);
  return { harness, publication, published: published.result, preflight: preflight.result, applied: applied.result, loaded: loaded.result.record };
}

describe("Stage 3 PCB synchronization API", () => {
  it("keeps preflight read-only in observation mode and overwrites body scope from authenticated headers", async () => {
    const harness = await readyHarness();
    const handler = createPcbSyncPostHandler(harness.service, () => "observe");
    const response = await handler(post({ operation: "preflight", request: { ...preflightRequest({ mode: "preview" }), tenantId: "attacker", projectId: "attacker", branchId: "attacker" } }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, operation: "preflight", boardChanged: false, result: { status: "ready_to_apply", summary: { boardChanged: false }, plan: { lifecycle: "validated", scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" } } } });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("blocks apply during observation mode and requires a second explicit opt-in in opt-in mode", async () => {
    const harness = await readyHarness();
    const observe = createPcbSyncPostHandler(harness.service, () => "observe");
    const prepared = await harness.service.preflight(preflightRequest());
    expect((await observe(post({ operation: "apply", request: applyRequest(prepared.plan!) }))).status).toBe(403);

    const optIn = createPcbSyncPostHandler(harness.service, () => "opt_in");
    const missingOptIn = await optIn(post({ operation: "apply", request: applyRequest(prepared.plan!) }));
    expect(await missingOptIn.json()).toMatchObject({ code: "PS_APPLY_OPT_IN_REQUIRED" });
  });

  it("applies only the exact prepared plan after human opt-in", async () => {
    const harness = await readyHarness();
    const handler = createPcbSyncPostHandler(harness.service, () => "opt_in");
    const preflightResponse = await handler(post({ operation: "preflight", request: preflightRequest() }));
    const preflightBody = await preflightResponse.json();
    const apply = applyRequest(preflightBody.result.plan);
    const response = await handler(post({ operation: "apply", request: apply }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, operation: "apply", boardChanged: true, result: { status: "applied", routerHandoff: { structuralValidationStatus: "passed" } } });
  });

  it("rejects client-provided authoritative snapshot, board, or path payloads", async () => {
    const harness = await readyHarness();
    const handler = createPcbSyncPostHandler(harness.service, () => "observe");
    for (const injected of [{ snapshot: {} }, { board: {} }, { path: "C:\\secret" }]) {
      const response = await handler(post({ operation: "preflight", request: preflightRequest(), ...injected }));
      expect(response.status).toBe(400);
      // B16.0.1: the forbidden-authoritative-field refusal moved into the ONE
      // shared authorization adapter (scopedTrustedJson), which names it
      // AUTH_AUTHORITATIVE_INPUT_FORBIDDEN — same 400 refusal, shared code.
      expect(await response.json()).toMatchObject({ code: "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN" });
    }
  });

  it("rejects unauthenticated requests and refuses apply for an insufficient membership role", async () => {
    const harness = await readyHarness();
    const handler = createPcbSyncPostHandler(harness.service, () => "opt_in");
    // B16.0: an unauthenticated request (no verified session) → 401. Identity
    // is server-derived, so this cannot be forged with headers.
    injectIdentity(null);
    const unauthenticated = await handler(post({ operation: "preflight", request: preflightRequest() }));
    expect(unauthenticated.status).toBe(401);

    // B16.0: a viewer's ROLE comes from membership, never from a header. A
    // viewer is refused apply with 403 — an AI actor kind can no longer be
    // asserted via a header at all (a strictly stronger guarantee).
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant-1", projectId: "project-1", role: "viewer" });
    const prepared = await harness.service.preflight(preflightRequest());
    const denied = await handler(post({ operation: "apply", request: applyRequest(prepared.plan!) }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    expect(denied.status).toBe(403);
    // B16.0.1: the viewer is now refused by the route-policy chokepoint
    // (POST /api/pcb-sync permits only pcb_editor/project_admin/automation)
    // with AUTH_ROLE_DENIED, BEFORE the handler's PS_APPLY_AUTHORIZATION_DENIED
    // service check can even run — a strictly earlier, stronger refusal.
    expect(await denied.json()).toMatchObject({ code: "AUTH_ROLE_DENIED" });
  });

  it("ignores caller apply time and evaluates expiry with the server-controlled clock", async () => {
    const harness = await readyHarness(), handler = createPcbSyncPostHandler(harness.service, () => "opt_in");
    const prepared = await harness.service.preflight(preflightRequest({ requestId: "api-time" }));
    const response = await handler(post({ operation: "apply", request: applyRequest(prepared.plan!, { requestId: "api-time-apply", requestedAt: "2099-01-01T00:00:00.000Z" }) }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { status: "applied", completedAt: APPLY_AT } });
  });

  it("returns a bounded expiry conflict without mutating or exposing internals", async () => {
    const harness = await readyHarness(), prepared = await harness.service.preflight(preflightRequest({ requestId: "api-expiry" }));
    const expiredService = new PcbSynchronizationService({ snapshotProvider: harness.snapshotProvider, resolver: harness.resolver, resourceProvider: harness.resourceProvider, repository: harness.repository, clock: () => prepared.plan!.expiresAt });
    const handler = createPcbSyncPostHandler(expiredService, () => "opt_in");
    const response = await handler(post({ operation: "apply", request: applyRequest(prepared.plan!, { requestId: "api-expiry-apply", requestedAt: prepared.plan!.createdAt }) }, { "x-sirkit-pcb-sync-opt-in": "true" }));
    const body = await response.json();
    expect(response.status).toBe(409);
    expect(body).toEqual({ ok: false, code: "PS_PLAN_EXPIRED", error: "PS_PLAN_EXPIRED" });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("publishes a canonical durable demo snapshot with digest-bound idempotency and CAS", async () => {
    const harness = await durableApiHarness(), issue = { code: "PS_FOOTPRINT_REVIEW_REQUIRED", severity: "blocking" as const, blocking: true, scope: "mapping" as const, stableIds: ["sync-u1"], displayRefs: ["U1"], message: "Footprint selection still requires review.", remediationCategory: "footprint_review", evidenceRefs: ["demo-source"], causedBy: [], retryability: "after_user_action" as const, helpKey: "footprint-review" }, request = publicationRequest(harness.source, { prerequisiteIssues: [issue] });
    request.components[0]!.pins.reverse();
    const firstResponse = await harness.postHandler(post({ operation: "publish_demo_snapshot", request })), first = await firstResponse.json();
    expect(firstResponse.status).toBe(201);
    expect(first).toMatchObject({ ok: true, operation: "publish_demo_snapshot", boardChanged: false, demoSecurity: { authentication: "deferred", gap: "R02-B1-011" }, result: { snapshotRevision: 1, created: true, idempotent: false, scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" }, actorId: "human-1", boardId: "board-1" } });
    expect(first.result.snapshot.components[0].pins.map((pin: { pinInstanceId: string }) => pin.pinInstanceId)).toEqual(["sync-u1:pin:1", "sync-u1:pin:2"]);
    expect(first.result.snapshot.prerequisiteIssues).toEqual([issue]);
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
    await expect(harness.snapshots.acquire(preflightRequest({ projectId: "project-other" }))).rejects.toThrow("PS_SNAPSHOT_NOT_FOUND");

    const retryResponse = await harness.postHandler(post({ operation: "publish_demo_snapshot", request })), retry = await retryResponse.json();
    expect(retryResponse.status).toBe(200);
    expect(retry.result).toMatchObject({ snapshotId: first.result.snapshotId, snapshotRevision: 1, snapshotDigest: first.result.snapshotDigest, created: false, idempotent: true });
    expect(retry.result.snapshot).toEqual(first.result.snapshot);

    const changed = structuredClone(request); changed.components[0]!.value = "changed";
    expect(await (await harness.postHandler(post({ operation: "publish_demo_snapshot", request: changed }))).json()).toMatchObject({ code: "PS_SNAPSHOT_IDEMPOTENCY_CONFLICT" });
    // B16.0: a "different actor, same digest" case no longer exists — the
    // actor id is server-derived and can never be varied by a client header.
    const stale = { ...structuredClone(request), requestId: "publish-stale", idempotencyKey: "publish-stale-key", schematicRevision: "schematic-r2" };
    // [B16-C.3] 409 with the newer revision NAMED (current vs expected) — distinct from malformed input (which never carries `conflict`).
    const staleResponse = await harness.postHandler(post({ operation: "publish_demo_snapshot", request: stale }));
    expect(staleResponse.status).toBe(409);
    expect(await staleResponse.json()).toMatchObject({ code: "PS_SNAPSHOT_REVISION_CONFLICT", conflict: { kind: "snapshot_revision", expectedRevision: stale.expectedSnapshotRevision, currentRevision: 1, attemptedSchematicRevision: "schematic-r2" } });
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
  });

  it("rejects malformed graphs, duplicate identities, oversized input, and body scope substitution before persistence", async () => {
    const harness = await durableApiHarness(), valid = publicationRequest(harness.source);
    const malformed = structuredClone(valid); malformed.nets[0]!.members[0]!.pinInstanceId = "missing-pin";
    expect(await (await harness.postHandler(post({ operation: "publish_demo_snapshot", request: malformed }))).json()).toMatchObject({ code: "PS_NET_MEMBER_REFERENCE_INVALID" });
    const duplicate = structuredClone(valid); duplicate.components.push(structuredClone(duplicate.components[0]!));
    expect(await (await harness.postHandler(post({ operation: "publish_demo_snapshot", request: duplicate }))).json()).toMatchObject({ code: "PS_COMPONENT_IDENTITY_DUPLICATE" });
    const substituted = { ...structuredClone(valid), tenantId: "attacker", actorContext: { actorId: "attacker" } };
    expect(await (await harness.postHandler(post({ operation: "publish_demo_snapshot", request: substituted }))).json()).toMatchObject({ code: "PS_API_UNKNOWN_FIELD" });
    const oversized = structuredClone(valid); oversized.components = Array.from({ length: 4_097 }, (_, index) => ({ ...structuredClone(valid.components[0]!), componentInstanceId: `oversize-${index}`, referenceDesignator: `U${index}`, pins: [] })); oversized.nets = [];
    expect((await harness.postHandler(post({ operation: "publish_demo_snapshot", request: oversized }))).status).toBe(413);
    expect(await harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
    await expect(harness.snapshots.acquire(preflightRequest())).rejects.toThrow("PS_SNAPSHOT_NOT_FOUND");
  });

  it("runs publication, ready preflight, guarded apply, exact board load, and durable reload", async () => {
    const workflow = new InMemoryDurableWorkflowRepository(), result = await exerciseReadyFlow(workflow), recomputed = makeBoardRecord({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1", board: result.loaded.board, updatedAt: result.loaded.updatedAt });
    expect(recomputed).toMatchObject({ revision: result.loaded.revision, digest: result.loaded.digest });
    const beforeRead = await workflow.listOutbox(), conditional = await result.harness.getHandler(get("board-1", {}, `&knownRevision=${encodeURIComponent(result.loaded.revision)}&knownDigest=${encodeURIComponent(result.loaded.digest)}`));
    expect(await conditional.json()).toMatchObject({ ok: true, result: { status: "not_modified" } });
    expect(await workflow.listOutbox()).toEqual(beforeRead);
    // B16.0: a cross-project selector is refused at 403 (no active membership
    // for project-other) BEFORE board existence is even considered — a
    // stronger isolation than the previous 404.
    expect((await result.harness.getHandler(get("board-1", { "x-sirkit-project-id": "project-other" }))).status).toBe(403);
    expect((await result.harness.getHandler(get("missing-board"))).status).toBe(404);

    const blockedRequest = publicationRequest(result.harness.source, { requestId: "publish-blocked", designId: "design-blocked", boardId: "board-blocked", schematicRevision: "schematic-blocked-r1", idempotencyKey: "publish-blocked-key" });
    blockedRequest.components = blockedRequest.components.map((component) => ({ ...component, componentInstanceId: "unresolved-u1", referenceDesignator: "U99", pins: component.pins.map((pin) => ({ ...pin, pinInstanceId: pin.pinInstanceId.replace("sync-u1", "unresolved-u1") })) }));
    blockedRequest.nets = blockedRequest.nets.map((net) => ({ ...net, members: net.members.map((member) => ({ ...member, componentInstanceId: "unresolved-u1", pinInstanceId: member.pinInstanceId.replace("sync-u1", "unresolved-u1") })) }));
    expect((await result.harness.postHandler(post({ operation: "publish_demo_snapshot", request: blockedRequest }))).status).toBe(201);
    const blockedPreflight = await (await result.harness.postHandler(post({ operation: "preflight", request: preflightRequest({ requestId: "preflight-blocked", designId: "design-blocked", schematicRevision: "schematic-blocked-r1", target: { kind: "new_board", boardId: "board-blocked", boardName: "Blocked", boardFormatVersion: "sirkit-json-pcb/1" } }) }))).json();
    expect(blockedPreflight.result.status).toBe("blocked_component_resolution");
    expect(await result.harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-blocked" })).toBeNull();
  });

  // B16-B item 5 (LB-4): opt-in via SIRKIT_DB_QUALIFICATION=1 + SIRKIT_DB_QUALIFICATION_URL — never .env.local, never DATABASE_URL.
  it.runIf(databaseQualification().enabled)("qualifies the same ready flow against isolated PostgreSQL", async () => {
    process.env.DATABASE_URL = withQualifiedDatabase();
    const { PostgresDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/server-repository");
    const result = await exerciseReadyFlow(new PostgresDurableWorkflowRepository()), committed = await result.harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" });
    expect(result.loaded.digest).toBe(result.applied.committedBoardDigest);
    const stale = publicationRequest(result.harness.source, { requestId: "pg-stale", schematicRevision: "schematic-pg-stale", idempotencyKey: "pg-stale-key" }), staleResponse = await result.harness.postHandler(post({ operation: "publish_demo_snapshot", request: stale }));
    expect(await staleResponse.json()).toMatchObject({ code: "PS_SNAPSHOT_REVISION_CONFLICT" });
    expect(await result.harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toEqual(committed);
    const blocked = publicationRequest(result.harness.source, { requestId: "pg-blocked", designId: "design-pg-blocked", boardId: "board-pg-blocked", schematicRevision: "schematic-pg-blocked", idempotencyKey: "pg-blocked-key" });
    blocked.components = blocked.components.map((component) => ({ ...component, componentInstanceId: "pg-unresolved", referenceDesignator: "U404", pins: component.pins.map((pin) => ({ ...pin, pinInstanceId: pin.pinInstanceId.replace("sync-u1", "pg-unresolved") })) }));
    blocked.nets = blocked.nets.map((net) => ({ ...net, members: net.members.map((member) => ({ ...member, componentInstanceId: "pg-unresolved", pinInstanceId: member.pinInstanceId.replace("sync-u1", "pg-unresolved") })) }));
    expect((await result.harness.postHandler(post({ operation: "publish_demo_snapshot", request: blocked }))).status).toBe(201);
    const blockedResult = await (await result.harness.postHandler(post({ operation: "preflight", request: preflightRequest({ requestId: "pg-blocked-preflight", designId: blocked.designId, schematicRevision: blocked.schematicRevision, target: { kind: "new_board", boardId: blocked.boardId, boardName: "PG Blocked", boardFormatVersion: "sirkit-json-pcb/1" } }) }))).json();
    expect(blockedResult.result.status).toBe("blocked_component_resolution");
    expect(await result.harness.repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: blocked.boardId })).toBeNull();
    process.stdout.write(`U01_FLOW_EVIDENCE=${JSON.stringify({ snapshotId: result.published.snapshotId, snapshotRevision: result.published.snapshotRevision, snapshotDigest: result.published.snapshotDigest, planId: result.preflight.plan.planId, planDigest: result.preflight.plan.planDigest, boardRevision: result.loaded.revision, boardDigest: result.loaded.digest, reloadDigest: result.loaded.digest, blockedStatus: blockedResult.result.status, staleStatus: staleResponse.status })}\n`);
  }, 30_000);
});
