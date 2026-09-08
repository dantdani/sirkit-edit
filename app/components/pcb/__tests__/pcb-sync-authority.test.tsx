// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildPcbSyncPublicationGraph } from "@/app/lib/pcb/netlist-bridge";
import { loadAuthoritativeBoardCache, loadLegacyBoardImport, saveAuthoritativeBoardCache, saveCurrentBoard } from "@/app/lib/pcb/board-persistence";
import { PcbSyncClient } from "@/app/lib/pcb-sync/client";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { applyRequest, preflightRequest, readyHarness } from "@/app/lib/pcb-sync/__tests__/fixtures";
import { createPcbSyncBoardGetHandler, createPcbSyncPostHandler } from "@/app/api/pcb-sync/handler";
import { databaseQualification, withQualifiedDatabase } from "@/app/lib/db/test-qualification";

vi.mock("@/app/lib/footprint-resolver/__tests__/fixtures", async () => {
  const { InMemoryPhysicalBindingRepository, PhysicalBindingService } = await import("@/app/lib/physical-binding/repository"), { createApprovedValidation } = await import("@/app/lib/physical-binding/transitions"), { ACTOR, exactCandidate, transition } = await import("@/app/lib/physical-binding/__tests__/fixtures");
  return { readyRepository: async (componentId = "resolver-ready") => { const repository = new InMemoryPhysicalBindingRepository(), service = new PhysicalBindingService(repository), candidate = exactCandidate(componentId); let state = await service.createCandidate(candidate, `create-${candidate.bindingId}`), request = transition(candidate, state.set.revision, "select", ACTOR); request.decisionEvidenceRefs = ["evidence-datasheet"]; state = await service.transition(state.set.setId, request); let current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!; request = transition(current, state.set.revision, "revalidate", ACTOR); request.validation = createApprovedValidation(current, { validatorVersion: "physical-binding-validator/1", at: request.at, evidenceRefs: ["evidence-mapping"] }); state = await service.transition(state.set.setId, request); current = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!; request = transition(current, state.set.revision, "approve", ACTOR); request.decisionEvidenceRefs = ["evidence-datasheet"]; state = await service.transition(state.set.setId, request); return { repository, binding: state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)! }; } };
});

const scope = { tenantId: "local", projectId: "project-1", branchId: "main" }, actor = { actorId: "human-1", actorKind: "human" as const, role: "project_admin" as const, sessionId: "session-1" };
const schematic: SchematicState = { components: [{ id: "resistor-1", type: "resistor", x: 0, y: 0, rotation: 0, value: "10k" }], wires: [] };
function json(result: object, status = 200): Response { return Response.json({ ok: true, result }, { status }); }
function publication(graph: ReturnType<typeof buildPcbSyncPublicationGraph>) { return { resultSchemaVersion: "sirkit.pcb-sync-demo-publication-result.v1", requestId: "publish-1", snapshotId: "snapshot-1", snapshotRevision: 1, snapshotDigest: "snapshot-digest-1", schematicDigest: "schematic-digest-1", netGraphDigest: "net-digest-1", scope, actorId: actor.actorId, designId: "design-1", boardId: "board-1", assemblyVariantId: "variant-default", created: true, idempotent: false, publishedAt: "2026-07-20T12:00:00.000Z", snapshot: { snapshotDigest: "snapshot-digest-1", schematicRevision: "schematic-1", components: graph.components, nets: graph.nets } }; }
function readyPreflight() { return { resultSchemaVersion: "sirkit.pcb-sync-preflight-result.v1", preflightId: "preflight-1", requestId: "preflight-request-1", status: "ready_to_apply", snapshot: {}, blockers: [], plan: { planId: "plan-1", planDigest: "plan-digest-1", lifecycle: "applicable", snapshot: {}, prerequisites: [] } }; }
function applyResult(record: ReturnType<typeof makeBoardRecord>) { return { resultSchemaVersion: "sirkit.pcb-sync-apply-result.v1", requestId: "apply-1", status: "applied", planId: "plan-1", planDigest: "plan-digest-1", boardChanged: true, originalBoardRevision: null, committedBoardRevision: record.revision, committedBoardDigest: record.digest, operationOutcomes: [], blockers: [], warnings: [], completedAt: "2026-07-20T12:01:00.000Z" }; }

describe("durable PCB editor authority", () => {
  it("publishes the actual canonical schematic and rejects duplicate identity before transport", () => {
    // B07.1/B07.2: the published reference IS the displayed reference
    // (refDes ?? id) — a legacy component without refDes publishes its
    // stable id verbatim, never a positionally synthesized "R1".
    const graph = buildPcbSyncPublicationGraph(schematic); expect(graph.components.map((item) => item.referenceDesignator)).toEqual(["resistor-1"]); expect(graph.components[0]?.pins.every((pin) => pin.disposition === "unconnected")).toBe(true);
    const duplicate: SchematicState = { ...schematic, kicadComponents: [{ id: "catalog-1", partId: "part-1", x: 100, y: 0, rotation: 0, refDes: "resistor-1", value: "1k", symbolAssetVersionId: "symbol:r1" }] };
    expect(() => buildPcbSyncPublicationGraph(duplicate, () => ({ pins: [{ number: "1", name: "A", type: "passive", orientation: 0, length: 100, position: { x: 0, y: 0 } }] }))).toThrow("PS_COMPONENT_IDENTITY_DUPLICATE");
  });

  it("keeps preflight non-mutating, then sends guarded explicit apply and authoritative GET", async () => {
    const graph = buildPcbSyncPublicationGraph(schematic), record = makeBoardRecord({ ...scope, boardId: "board-1", board: createEmptyBoard(), updatedAt: "2026-07-20T12:01:00.000Z" });
    const transport = vi.fn().mockResolvedValueOnce(json(publication(graph), 201)).mockResolvedValueOnce(json(readyPreflight())).mockResolvedValueOnce(json(applyResult(record))).mockResolvedValueOnce(json({ resultSchemaVersion: "sirkit.pcb-sync-board-load-result.v1", status: "found", scope: { ...scope, boardId: "board-1" }, record }));
    const client = new PcbSyncClient({ ...scope, actor }, transport), published = await client.publish({ requestSchemaVersion: "sirkit.pcb-sync-demo-publication-request.v1", requestId: "publish-1", designId: "design-1", boardId: "board-1", boardName: "Main", projectRevision: "project-1", designRevision: "design-1", schematicRevision: "schematic-1", componentSetRevision: "components-1", netGraphRevision: "nets-1", assemblyVariantId: "variant-default", assemblyVariantRevision: "variant-1", librarySnapshotRevision: "library-1", expectedSnapshotRevision: 0, idempotencyKey: "publish-key-1", ...graph, requestedAt: "2026-07-20T12:00:00.000Z" });
    expect(published.ok).toBe(true);
    const preflight = await client.preflight({ requestSchemaVersion: "sirkit.pcb-sync-preflight-request.v1", requestId: "preflight-1", designId: "design-1", schematicRevision: "schematic-1", assemblyVariantId: "variant-default", target: { kind: "new_board", boardId: "board-1", boardName: "Main", boardFormatVersion: "sirkit-json-pcb/1" }, resolutionPolicyId: "resolution", resolutionPolicyVersion: "1", syncPolicyId: "sync", syncPolicyVersion: "1", requestedAt: "2026-07-20T12:00:00.000Z", mode: "prepare_apply" });
    expect(preflight.ok).toBe(true); expect(transport).toHaveBeenCalledTimes(2); expect(JSON.parse(String(transport.mock.calls[1]?.[1]?.body)).operation).toBe("preflight");
    const applied = await client.apply({ requestSchemaVersion: "sirkit.pcb-sync-apply-request.v1", requestId: "apply-1", designId: "design-1", boardId: "board-1", planId: "plan-1", planDigest: "plan-digest-1", expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan", idempotencyKey: "apply-key-1", warningAcknowledgements: [], requestedAt: "2026-07-20T12:01:00.000Z" });
    expect(applied.ok).toBe(true); expect(new Headers(transport.mock.calls[2]?.[1]?.headers).get("x-sirkit-pcb-sync-opt-in")).toBe("true"); expect(JSON.parse(String(transport.mock.calls[2]?.[1]?.body)).request.confirmation).toBe("apply_exact_plan");
    const loaded = await client.loadBoard("board-1"); expect(loaded.ok && loaded.value.status).toBe("found");
  });

  it("rejects mismatched authoritative board content and keeps cache revision-bound", async () => {
    localStorage.clear(); const record = makeBoardRecord({ ...scope, boardId: "board-1", board: createEmptyBoard(), updatedAt: "2026-07-20T12:00:00.000Z" });
    expect(saveAuthoritativeBoardCache(record)).toBe(true); expect(loadAuthoritativeBoardCache({ ...scope, boardId: "board-1" }, record)).toEqual(record); expect(loadAuthoritativeBoardCache({ ...scope, boardId: "board-1" }, { revision: "newer", digest: "newer" })).toBeNull();
    const corrupt = { ...record, digest: "wrong" }, client = new PcbSyncClient({ ...scope, actor }, vi.fn().mockResolvedValue(json({ resultSchemaVersion: "sirkit.pcb-sync-board-load-result.v1", status: "found", scope: { ...scope, boardId: "board-1" }, record: corrupt })));
    expect((await client.loadBoard("board-1")).ok).toBe(false);
  });

  it("classifies old local PCB data as explicit legacy import and never calls legacy sync", async () => {
    localStorage.clear();
    // [B12.5 §C] PCB persistence no longer activates projects: the current
    // project is established ONLY by the page's transactional activation
    // (markProjectCurrent), and board saves land on it without ever
    // touching the pointer. saveCurrentBoard on an empty workspace still
    // succeeds — it materializes an INACTIVE record — but legacy import
    // reads the ACTIVE project, so the fixture activates one first.
    const { createProjectRecord, markProjectCurrent } = await import("@/app/lib/project/current");
    const record = createProjectRecord("Legacy import fixture");
    expect(markProjectCurrent(record.id).ok).toBe(true);
    expect(saveCurrentBoard(createEmptyBoard(), schematic, null)).toBe(true);
    expect(localStorage.getItem("sirkit:currentProjectId")).toBe(record.id); // the save did NOT repoint
    expect(loadLegacyBoardImport()).not.toBeNull();
    // [B08.3] the ambient `applyingRef` single-flight boolean was replaced
    // by the request-owned operation registry (behaviorally covered in
    // b08-3-owned-sync.test.ts); the editor still never calls legacy sync.
    const source = readFileSync(`${process.cwd()}/app/components/pcb/PcbEditor.tsx`, "utf8"); expect(source).not.toMatch(/\bsyncFromSchematic\s*\(/); expect(source).toContain('runVerifiedServerAdoption(ownedOps, "sync-apply"'); expect(source).toContain("Apply sync plan"); expect(source).not.toContain("saveCurrentBoard(");
  });

  // B16-B item 5 (LB-4): opt-in via SIRKIT_DB_QUALIFICATION=1 + SIRKIT_DB_QUALIFICATION_URL — never .env.local, never DATABASE_URL.
  it.runIf(databaseQualification().enabled)("uses the editor client through real handlers and PostgreSQL durable authority", async () => {
    process.env.DATABASE_URL = withQualifiedDatabase(); const { PostgresDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/server-repository"), workflow = new PostgresDurableWorkflowRepository(), source = await readyHarness(), snapshots = new DurablePcbSyncSnapshotStore(workflow), repository = new DurablePcbSyncRepository(workflow), service = new PcbSynchronizationService({ snapshotProvider: snapshots, resolver: source.resolver, resourceProvider: source.resourceProvider, repository, clock: () => "2026-07-19T12:01:00.000Z" }), post = createPcbSyncPostHandler(service, () => "opt_in", { snapshotPublisher: snapshots, repository, clock: () => "2026-07-19T12:00:00.000Z" }); let get = createPcbSyncBoardGetHandler(repository, () => "opt_in");
    const boundary = (input: RequestInfo | URL, init?: RequestInit) => { const request = new Request(new URL(String(input), "http://localhost"), init); return request.method === "GET" ? get(request) : post(request); }, client = new PcbSyncClient({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", actor }, boundary), snapshot = source.snapshot;
    const published = await client.publish({ requestSchemaVersion: "sirkit.pcb-sync-demo-publication-request.v1", requestId: "retry02-pg-publish", designId: snapshot.designId, boardId: "board-1", boardName: "Retry02", projectRevision: snapshot.projectRevision, designRevision: snapshot.designRevision, schematicRevision: snapshot.schematicRevision, componentSetRevision: snapshot.componentSetRevision, netGraphRevision: snapshot.netGraphRevision, assemblyVariantId: snapshot.assemblyVariantId, assemblyVariantRevision: snapshot.assemblyVariantRevision, librarySnapshotRevision: snapshot.librarySnapshotRevision, expectedSnapshotRevision: 0, idempotencyKey: "retry02-pg-publish-key", components: snapshot.components, nets: snapshot.nets, prerequisiteIssues: snapshot.prerequisiteIssues, requestedAt: "2026-07-20T12:00:00.000Z" }); expect(published.ok).toBe(true);
    const previewBase = preflightRequest({ requestId: "retry02-pg-preflight", target: { kind: "new_board", boardId: "board-1", boardName: "Retry02", boardFormatVersion: "sirkit-json-pcb/1" } }), { tenantId: _tenant, projectId: _project, branchId: _branch, actorContext: _actor, ...previewRequest } = previewBase; void _tenant; void _project; void _branch; void _actor; const preview = await client.preflight(previewRequest); if (!preview.ok || preview.value.status !== "ready_to_apply" || !preview.value.plan) throw new Error(`RETRY02_PREFLIGHT_${preview.ok ? `${preview.value.status}:${JSON.stringify({ blockers: preview.value.blockers, components: preview.value.components })}` : preview.code}`); expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
    const applyBase = applyRequest(preview.value.plan, { requestId: "retry02-pg-apply", boardId: "board-1", idempotencyKey: "retry02-pg-apply-key" }), { tenantId: _at, projectId: _ap, branchId: _ab, actorContext: _aa, ...guardedApply } = applyBase; void _at; void _ap; void _ab; void _aa; const applied = await client.apply(guardedApply); expect(applied.ok).toBe(true); const loaded = await client.loadBoard("board-1"); expect(loaded.ok && loaded.value.status).toBe("found");
    get = createPcbSyncBoardGetHandler(new DurablePcbSyncRepository(new PostgresDurableWorkflowRepository()), () => "opt_in"); const reloaded = await new PcbSyncClient({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", actor }, boundary).loadBoard("board-1"); expect(reloaded).toEqual(loaded);
  }, 30_000);
});
