/**
 * [PR-L6, 2026-10-19] Runbook M.5 item 7 for the M2 path (artifacts/product-reliability-simple-ui/component-resolution/
 * m2-acquisition-design.md, its m2-7 row; OD-253 item 8): an ACQUIRED revision whose footprint differs from what the project's
 * durable board carries goes through the same PCB impact, receipt and drift path as a local replacement.
 *
 * The chain is M2's own over the production services and a real, migrated PostgreSQL (PGlite; _m2-chain.ts): no local candidate ->
 * the fixture CAD source -> bytes -> validation -> a PERSON sends it for review -> two humans publish -> the task's recheck offers it ->
 * M1's sealed batch. The project already has a durable board on which D1 / D2 sit under an EARLIER identity (an SOD-123 revision the
 * project used before - resolved, synchronized, then undone, the realistic chain); the acquired 1N4148 is DO-35 through-hole:
 *
 *  - the impact (against that board) says footprint_changed for D1 / D2, Prepare PCB replaces them in place on the unrouted board, the
 *    re-bind is disclosed, and placement legality, DRC and stage evidence go stale - parity, DRC and readiness are retired, never kept;
 *  - the apply records the impact's summary in the receipt v2;
 *  - the drift is derived from the facts: `changed` against the old board, none against a board carrying the acquired identity;
 *    Undo shows D1 / D2 `unresolved` on the old board, Redo `changed` again; a save / reload (JSON round trip of both artifacts) gives
 *    the same answer and keeps the stable instance ids (the sheet identity is the instance id, never the reference).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";
import type { SchematicState } from "@/lib/schematic-types";

const seams = vi.hoisted(() => ({ embedded: [] as string[], reranked: 0 }));
let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async (text: string) => { seams.embedded.push(text); throw new Error("no embedding provider in this test"); }) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class CountingReranker { messages = { create: () => { seams.reranked += 1; throw new Error("no reranker in this test"); } }; } }));

import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import type { AgentRunContext, GatewayInvocationOutcome } from "@/app/lib/agent/contracts";
import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resolveComponentResolutionPorts } from "@/app/api/chat/component-resolution-runtime";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { loadFreshResolutionFacts } from "@/app/lib/component-resolution/facts-loader";
import type { SealedResolutionProposal } from "@/app/lib/component-resolution/resolution-proposal";
import { applyApprovedResolutionProposal } from "@/app/lib/component-resolution/approved-resolution-mutations";
import { issueResolutionApprovalIntent } from "@/app/lib/component-resolution/resolution-approval.internal";
import { __createTestResolutionReauthorizationChannel } from "@/app/lib/component-resolution/resolution-reauthorization";
import { loadAcquisitionHandoff } from "@/app/lib/component-resolution/acquisition/handoff";
import { resetComponentResolutionRuntimeFactory } from "@/app/lib/component-resolution/task/runtime";
import { resetCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { resetMembershipRepositoryFactory } from "@/app/lib/auth/identity-runtime";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import type { CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { schematicEndpointKey, stableNetIdForEndpoints } from "@/app/lib/pcb/integrity";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { boardSchematicDrift } from "@/app/lib/pcb-sync/schematic-drift";
import { assessResolutionBoardImpact, boardImpactSentences, resolutionBoardImpactItems, resolutionBoardImpactSummary, type ResolutionBoardBasis, type ResolutionReceiptBoardImpact } from "../board-impact";
import { componentResolutionBoardImpactView } from "@/app/lib/project/component-resolution-events";
import { switchingDiodeRevision } from "./_m1-fixtures";
import { chainMemberships, chainRuntime, chainSheet, human, publishBy, seedChainCatalog, submitAndApprove, USERS, type ChainCatalog } from "./_m2-chain";

const SCOPE = { tenantId: "local", projectId: "p-m2-7-existing-board", branchId: "main" } as const;
const BOARD_ID = `board:${SCOPE.projectId}`;
let catalog: ChainCatalog;
const hashedVector = (): string => `[${new Array(1_536).fill(0).map((_, index) => (index === 0 ? 1 : 0)).join(",")}]`;

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  catalog = await seedChainCatalog(pg, hashedVector);
}, 240_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgres://catalog-configured-placeholder"); // presence only: the client is the PGlite above
  seams.embedded.length = 0;
  seams.reranked = 0;
  resetAdmissionControl();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetComponentResolutionRuntimeFactory(); resetCadSourceInjection(); resetMembershipRepositoryFactory(); });

interface Harness { editor: SchematicEditorSession; coordinator: SchematicGestureCoordinator; history: SchematicHistory<SchematicState>; visible(): SchematicState; invoke(toolId: string, args: Record<string, unknown>): Promise<GatewayInvocationOutcome>; journalStore: InMemoryApprovedMutationJournalStore; interlock: ProjectCommitInterlock; registry: ApprovedMutationRegistry }

async function harness(state: SchematicState): Promise<Harness> {
  const editor = new SchematicEditorSession(SCOPE, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "Opened project" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible), applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({ flushPendingRecord: () => {}, history: () => history, applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); }, snapshot: (authoritative) => structuredClone(authoritative), historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {} }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); }, execute: (base, request) => editor.execute(base, request), notify: () => {},
  });
  const context = (): AgentRunContext => {
    const assembly = assembleAgentRunContext({ ...SCOPE, schematic: structuredClone(visible), schematicHeadMark: editor.headMark(), catalogInspectionAvailable: true, componentResolutionAvailable: resolveComponentResolutionPorts().evidence !== undefined });
    if (!assembly.ok) throw new Error(assembly.reason);
    return assembly.context;
  };
  const gateway = createAgentToolGateway(sirkitToolRegistry(), { catalogInspection: resolveCatalogInspectionPort()!, componentResolution: { evidence: resolveComponentResolutionPorts().evidence! } });
  return { editor, coordinator, history, visible: () => structuredClone(visible), invoke: (toolId, args) => gateway.invoke({ runId: "run-m2-7", provider: "anthropic", toolId, version: "1.0.0", args, context: context(), timeoutMs: 15_000 }), journalStore: new InMemoryApprovedMutationJournalStore(), interlock: new ProjectCommitInterlock(), registry: new ApprovedMutationRegistry() };
}

function apply(h: Harness, proposal: SealedResolutionProposal, boardImpact: ResolutionReceiptBoardImpact) {
  const intent = issueResolutionApprovalIntent({ proposalId: proposal.proposalId, scope: SCOPE, headMark: proposal.scope.headMark, authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision }, now: Date.now() });
  const channel = __createTestResolutionReauthorizationChannel(async (body) => {
    const request = JSON.parse(body) as { nonce: string; proposalId: string; scope: typeof SCOPE; items: Array<{ componentInstanceId: string; currentPartId: string; candidatePartId: string; atomicPartRevisionId: string }>; partIds: string[] };
    const facts = await loadFreshResolutionFacts({ catalog: resolveCatalogInspectionPort()!, evidence: resolveComponentResolutionPorts().evidence!, request: { items: request.items, partIds: request.partIds }, context: { scope: request.scope, runId: "apply", budgetMs: 10_000 } });
    return facts ? { ok: true, text: JSON.stringify({ ok: true, ...facts, binding: { nonce: request.nonce, proposalId: request.proposalId, scope: SCOPE } }) } : { ok: false, text: "{}" };
  });
  return applyApprovedResolutionProposal({ proposal, session: h.editor, gateway: h.coordinator, interlock: h.interlock, journal: new ApprovedMutationJournal(h.journalStore, SCOPE), stillCurrent: () => true, currentProjectId: SCOPE.projectId, currentBranchId: "main", originRunId: "run-m2-7", approval: intent, reauthorization: channel, registry: h.registry, audit: new ApprovedMutationAuditLedger(), boardImpact });
}

/** The project's durable board: U1 / R1 / C1 under their own identities, D1 / D2 synchronized under `identity` (pads 1 = K, 2 = A) on the dimmer's TIMING / RA / RB nets. */
function boardWith(sheet: SchematicState, identity: { symbolAssetVersionId: string; footprintAssetVersionId: string; mappingCertificateId: string }): PcbBoard {
  const nets = [
    { name: "/root/TIMING", keys: [schematicEndpointKey("kc-d1", "1"), schematicEndpointKey("kc-d2", "2")] },
    { name: "/root/RA", keys: [schematicEndpointKey("kc-d1", "2")] },
    { name: "/root/RB", keys: [schematicEndpointKey("kc-d2", "1")] },
  ].map((net, index) => ({ id: index + 1, name: net.name, stableId: stableNetIdForEndpoints(net.keys, net.name), endpointKeys: [...net.keys].sort() }));
  const footprint = (id: string, ref: string, padNets: Record<string, number>, own = identity) => ({
    id, ref, footprintId: own.footprintAssetVersionId, def: { libName: "Diode_SMD", name: "D_SOD-123", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" },
    at: { x: 1_000_000, y: 2_000_000 }, rotationDeg: 0, side: "top" as const, padNets,
    pinPadMappings: ["1", "2"].map((pin) => ({ componentInstanceId: id, endpointKey: schematicEndpointKey(id, pin), symbolPinNumber: pin, padNumbers: [pin], mappingKind: "electrical" as const, provenance: "library-explicit" as const })),
    syncIdentity: { componentInstanceId: id, bindingRevisionId: `binding-${id}`, footprintContentDigest: "sha256:sod123", syncPlanId: "plan-earlier", ...own },
  });
  const others = (sheet.kicadComponents ?? []).filter((instance) => instance.id !== "kc-d1" && instance.id !== "kc-d2" && instance.atomicPartRevisionId).map((instance) => footprint(instance.id, instance.refDes, {}, { symbolAssetVersionId: instance.symbolAssetVersionId!, footprintAssetVersionId: instance.footprintAssetVersionId!, mappingCertificateId: instance.mappingCertificateId! }));
  return { ...createEmptyBoard(), nets: [createEmptyBoard().nets[0]!, ...nets], footprints: [...others, footprint("kc-d1", "D1", { "1": 1, "2": 2 }), footprint("kc-d2", "D2", { "1": 3, "2": 1 })] };
}
const basisOf = (board: PcbBoard): ResolutionBoardBasis & { state: "board" } => ({ state: "board", boardId: BOARD_ID, record: makeBoardRecord({ ...SCOPE, boardId: BOARD_ID, board, updatedAt: "2026-10-19T00:00:00.000Z" }), authority: { revision: 2, recordDigest: "sha256:authority-2", current: true }, latestRelease: null });
const view = (answer: { body: Record<string, unknown> }): CadAcquisitionTaskView => answer.body.task as CadAcquisitionTaskView;

describe("[PR-L6 M.5-7] an acquired revision with another footprint on a project with a durable board", { timeout: 240_000 }, () => {
  it("goes through the same PCB impact, receipt v2 and fact-derived drift path; undo / redo / save / reload keep it consistent", async () => {
    const memberships = chainMemberships([SCOPE]);
    const chain = chainRuntime();
    const h = await harness(chainSheet(catalog));
    const before = h.visible();
    const requester = { principalId: USERS.requester, role: "pcb_editor" as const, membershipRevision: null, actorKind: "human" as const };
    // the earlier identity the board still carries for D1 / D2 (an SOD-123 revision the project used before it was undone)
    const earlier = switchingDiodeRevision("m2-7-earlier", "1N4148W-7-F");
    const earlierIdentity = { symbolAssetVersionId: earlier.snapshot.symbol.versionId, footprintAssetVersionId: earlier.snapshot.footprint!.versionId, mappingCertificateId: earlier.snapshot.mapping!.id };
    const oldBoard = boardWith(before, earlierIdentity);
    expect(boardSchematicDrift(before, oldBoard).items.map((item) => [item.schematicRefDes, item.kind])).toEqual([["D1", "unresolved"], ["D2", "unresolved"]]);

    // ── M2's chain: acquire -> a person sends it -> two humans publish -> the task's recheck offers the published revision ──
    const started = await chain.service.start(SCOPE, requester, { request: { componentIds: ["kc-d1", "kc-d2"], requirement: { mounting: "through_hole", packageCode: "DO-35" }, assetKinds: ["symbol", "footprint", "datasheet"] }, schematic: before, headMark: h.editor.headMark(), origin: "page" });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    const taskId = view(started).taskId;
    expect((await chain.runWorker()).slices.map((slice) => [slice.kind, slice.outcome])).toEqual([["acquire", "ended"]]);
    const sent = await chain.service.handoff(SCOPE, human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send-for-review-1" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const handoff = (await loadAcquisitionHandoff(chain.handoffDeps, sent.body.handoffId as string))!;
    const deps = chain.publicationDeps(memberships);
    const approved = await submitAndApprove(deps, handoff.package.spec, handoff.package.links);
    const published = await publishBy(deps, approved.requestId);
    const revisionId = published.request.publication!.revisionId;
    expect((await chain.service.control(SCOPE, requester, { taskId, action: "recheck", clientActionId: "check-again-1" })).status).toBe(200);
    expect((await chain.runWorker()).slices.map((slice) => [slice.kind, slice.outcome])).toEqual([["recheck", "ended"]]);
    const task = view(await chain.service.read(SCOPE, taskId));
    expect(task.proposal).toMatchObject({ componentIds: ["kc-d1", "kc-d2"], atomicPartRevisionId: revisionId });

    // ── M1's sealed batch over the acquired revision, and its PCB impact against the durable board (BEFORE approval) ──
    const sealed = await h.invoke("sirkit.schematic.propose-component-resolution", { items: task.proposal!.componentIds.map((componentId) => ({ componentId, candidatePartId: task.proposal!.candidatePartId, atomicPartRevisionId: task.proposal!.atomicPartRevisionId })) });
    expect(sealed.kind, JSON.stringify(sealed)).toBe("resolution-proposal");
    if (sealed.kind !== "resolution-proposal") return;
    const impact = assessResolutionBoardImpact({ items: resolutionBoardImpactItems(sealed.proposal), basis: basisOf(oldBoard) });
    expect(sealed.proposal.impact.items[0]!.target.footprintFullName).toBe("Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal");
    expect(impact.items.map((item) => [item.schematicRefDes, item.outcome, item.predicted.operation, item.rebind])).toEqual([["D1", "footprint_changed", "replace_unrouted_footprint", true], ["D2", "footprint_changed", "replace_unrouted_footprint", true]]);
    expect(impact.items[0]!.pins.map((row) => [row.pin, row.toPin, row.net, row.boardPads, row.targetPads])).toEqual([["1", "1", "/root/TIMING", ["1"], ["1"]], ["2", "2", "/root/RA", ["2"], ["2"]]]);
    // parity, DRC and readiness are retired (placement legality, DRC, the authority, the stage evidence); routing has no copper to lose
    expect(impact).toMatchObject({ predictedCodes: [], requiresBoardRevision: false, invalidates: { placementLegality: true, drc: true, routing: false, authority: { revision: 2, recordDigest: "sha256:authority-2" }, stageEvidence: true } });
    const dialog = componentResolutionBoardImpactView({ state: "assessed", impact });
    expect(dialog.rows.map((row) => row.text).join(" ")).toContain("Prepare PCB: replace unrouted footprint; re-binding needed");
    expect(dialog.invalidates).toEqual(["placement legality", "DRC", "qualification authority r2", "local stage evidence"]);

    // ── the human's apply carries the reviewed impact into the receipt v2 ──
    const summary = resolutionBoardImpactSummary(impact);
    const applied = await apply(h, sealed.proposal, summary);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" });
    if (!applied.ok || applied.status !== "committed") throw new Error("unreachable");
    expect(applied.receipt).toMatchObject({ schema: "sirkit.approved-resolution-receipt.v2", boardImpact: summary });
    expect(boardImpactSentences(applied.receipt.boardImpact!).join(" ")).toMatch(/D1: footprint changes \(replace unrouted footprint\).*Goes stale until Prepare PCB re-runs: placement legality, DRC, qualification authority r2, stage evidence/);

    // ── the drift, derived from the facts each time ──
    const after = h.visible();
    const acquired = after.kicadComponents!.find((instance) => instance.id === "kc-d1")!;
    expect(acquired.atomicPartRevisionId).toBe(revisionId);
    const acquiredIdentity = { symbolAssetVersionId: acquired.symbolAssetVersionId!, footprintAssetVersionId: acquired.footprintAssetVersionId!, mappingCertificateId: acquired.mappingCertificateId! };
    expect(boardSchematicDrift(after, oldBoard).items.map((item) => [item.componentInstanceId, item.kind, item.fields])).toEqual([["kc-d1", "changed", ["footprintAssetVersionId", "mappingCertificateId", "symbolAssetVersionId"]], ["kc-d2", "changed", ["footprintAssetVersionId", "mappingCertificateId", "symbolAssetVersionId"]]]);
    expect(boardSchematicDrift(after, boardWith(after, acquiredIdentity)).items).toEqual([]); // a Prepare PCB that carried the acquired parts: nothing behind
    const undone = h.history.undo()!;
    expect(await h.editor.reconcileHistoryStep("undo", undone)).toMatchObject({ ok: true });
    expect(boardSchematicDrift(undone, oldBoard).items.map((item) => item.kind)).toEqual(["unresolved", "unresolved"]);
    const redone = h.history.redo()!;
    expect(await h.editor.reconcileHistoryStep("redo", redone)).toMatchObject({ ok: true });
    expect(boardSchematicDrift(redone, oldBoard).items.map((item) => item.kind)).toEqual(["changed", "changed"]);
    // save / reload: both artifacts serialized; the same drift, the same stable instance ids (identity is the id, never the reference)
    const saved = JSON.parse(JSON.stringify({ schematic: redone, board: oldBoard })) as { schematic: SchematicState; board: PcbBoard };
    expect(boardSchematicDrift(saved.schematic, saved.board)).toEqual(boardSchematicDrift(redone, oldBoard));
    expect(saved.schematic.kicadComponents!.map((instance) => instance.id)).toEqual(before.kicadComponents!.map((instance) => instance.id));
    // nothing paid, no model
    expect(seams.embedded).toEqual([]);
    expect(seams.reranked).toBe(0);
  });
});
