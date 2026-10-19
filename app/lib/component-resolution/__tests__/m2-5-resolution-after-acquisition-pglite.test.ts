/**
 * [PR-M, 2026-10-18] Runbook M.5 item 4 - the WHOLE chain over the production service boundaries and a real, migrated PostgreSQL:
 *
 *   no local candidate -> the fixture CAD source (real committed KiCad bytes through the production egress path) -> real bytes ->
 *   parse / validate -> durable candidate -> a PERSON sends it for review -> a governance editor submits, a reviewer approves, a DIFFERENT
 *   administrator publishes (the publication transaction re-verifies every byte) -> the task re-runs M1's candidate search -> the eligible
 *   revision is offered -> M1's sealed batch, the human's reviewed apply (one canonical transaction, a receipt, a new revision) -> the
 *   electrical check (nets and polarity kept) and the Prepare PCB preflight, recorded on the task.
 *
 * Every assertion reads stored rows and receipts (never a mock's `published: true`). The embedding and the reranker are COUNTING fakes
 * that stay at 0; the only CAD transport calls are the acquisition's four.
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
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import { buildNetlist } from "@/app/lib/pcb/netlist-bridge";
import { loadCatalogParts, loadFreshResolutionFacts } from "@/app/lib/component-resolution/facts-loader";
import { netlistLookupOf } from "@/app/lib/component-resolution/instance-facts";
import type { SealedResolutionProposal } from "@/app/lib/component-resolution/resolution-proposal";
import { applyApprovedResolutionProposal } from "@/app/lib/component-resolution/approved-resolution-mutations";
import { issueResolutionApprovalIntent } from "@/app/lib/component-resolution/resolution-approval.internal";
import { __createTestResolutionReauthorizationChannel } from "@/app/lib/component-resolution/resolution-reauthorization";
import { loadAcquisitionHandoff } from "@/app/lib/component-resolution/acquisition/handoff";
import { resetComponentResolutionRuntimeFactory } from "@/app/lib/component-resolution/task/runtime";
import { resetCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { resetMembershipRepositoryFactory } from "@/app/lib/auth/identity-runtime";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { KICAD_LIBRARY_PINS } from "@/app/lib/kicad/pinned-checkout";
import type { CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { chainMemberships, chainRuntime, chainSheet, GOVERNANCE, human, publishBy, seedChainCatalog, submitAndApprove, USERS, type ChainCatalog } from "./_m2-chain";
import { PIN_TABLE_1N4148 } from "./_m2-fixtures";
import { sha256 } from "@/app/lib/atomic/stable";

const SCOPE = { tenantId: "local", projectId: "p-m2-led-dimmer", branchId: "main" } as const;
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

// ─── M1's sealing gateway and reviewed apply over the real schematic session (as m1-led-dimmer-resolution.test.ts) ─────────────────

interface Harness { editor: SchematicEditorSession; coordinator: SchematicGestureCoordinator; history: SchematicHistory<SchematicState>; visible(): SchematicState; context(): AgentRunContext; invoke(toolId: string, args: Record<string, unknown>): Promise<GatewayInvocationOutcome>; journalStore: InMemoryApprovedMutationJournalStore; interlock: ProjectCommitInterlock; registry: ApprovedMutationRegistry }

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
  return { editor, coordinator, history, visible: () => structuredClone(visible), context, invoke: (toolId, args) => gateway.invoke({ runId: "run-m2", provider: "anthropic", toolId, version: "1.0.0", args, context: context(), timeoutMs: 15_000 }), journalStore: new InMemoryApprovedMutationJournalStore(), interlock: new ProjectCommitInterlock(), registry: new ApprovedMutationRegistry() };
}

function apply(h: Harness, proposal: SealedResolutionProposal) {
  const intent = issueResolutionApprovalIntent({ proposalId: proposal.proposalId, scope: SCOPE, headMark: proposal.scope.headMark, authorization: { principalId: proposal.authorization.principalId, membershipRevision: proposal.authorization.membershipRevision }, now: Date.now() });
  const channel = __createTestResolutionReauthorizationChannel(async (body) => {
    const request = JSON.parse(body) as { nonce: string; proposalId: string; scope: typeof SCOPE; items: Array<{ componentInstanceId: string; currentPartId: string; candidatePartId: string; atomicPartRevisionId: string }>; partIds: string[] };
    const facts = await loadFreshResolutionFacts({ catalog: resolveCatalogInspectionPort()!, evidence: resolveComponentResolutionPorts().evidence!, request: { items: request.items, partIds: request.partIds }, context: { scope: request.scope, runId: "apply", budgetMs: 10_000 } });
    return facts ? { ok: true, text: JSON.stringify({ ok: true, ...facts, binding: { nonce: request.nonce, proposalId: request.proposalId, scope: SCOPE } }) } : { ok: false, text: "{}" };
  });
  return applyApprovedResolutionProposal({ proposal, session: h.editor, gateway: h.coordinator, interlock: h.interlock, journal: new ApprovedMutationJournal(h.journalStore, SCOPE), stillCurrent: () => true, currentProjectId: SCOPE.projectId, currentBranchId: "main", originRunId: "run-m2", approval: intent, reauthorization: channel, registry: h.registry, audit: new ApprovedMutationAuditLedger() });
}

async function netsByFunction(state: SchematicState): Promise<Record<string, string[]>> {
  const partIds = [...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))];
  const parts = (await loadCatalogParts(resolveCatalogInspectionPort()!, partIds, { scope: SCOPE, runId: "check", budgetMs: 10_000 })).parts;
  const netlist = buildNetlist(state, netlistLookupOf(parts));
  const byId = new Map((state.kicadComponents ?? []).map((instance) => [instance.id, instance] as const));
  return Object.fromEntries(netlist.nets.filter((net) => !net.name.startsWith("N$")).map((net) => [net.name, net.nodes.map((node) => { const instance = byId.get(node.componentId)!; const load = parts.get(instance.partId); const name = load?.state === "found" ? (load.detail.pins as Array<{ number: string; name: string }>).find((pin) => pin.number === node.pinNumber)?.name ?? node.pinNumber : node.pinNumber; return `${instance.refDes}.${name === "~" ? node.pinNumber : name}`; }).sort()]));
}

const view = (answer: { body: Record<string, unknown> }): CadAcquisitionTaskView => answer.body.task as CadAcquisitionTaskView;

describe("[PR-M M.5-4] no local candidate -> fixture source -> bytes -> validation -> durable candidate -> two-person publication -> eligible -> resolution -> apply -> preflight", { timeout: 240_000 }, () => {
  it("runs the whole chain through the production services; every step's evidence is a stored row or a receipt", async () => {
    const memberships = chainMemberships([SCOPE]);
    const chain = chainRuntime();
    const h = await harness(chainSheet(catalog));
    const before = h.visible();
    const netsBefore = await netsByFunction(before);
    expect(buildPcbSyncPreflightReport(before)).toMatchObject({ unresolved: { count: 2 } });
    const requester = { principalId: USERS.requester, role: "pcb_editor" as const, membershipRevision: null, actorKind: "human" as const };

    // ── 1. start: a verified schematic snapshot, no board; the target derived from the server catalog part ──
    const started = await chain.service.start(SCOPE, requester, { request: { componentIds: ["kc-d1", "kc-d2"], requirement: { mounting: "through_hole", packageCode: "DO-35" }, assetKinds: ["symbol", "footprint", "datasheet"] }, schematic: before, headMark: h.editor.headMark(), origin: "page" });
    expect(started.status, JSON.stringify(started.body)).toBe(202);
    const taskId = view(started).taskId;
    expect(view(started)).toMatchObject({ state: "queued", targets: [{ refDes: "D1", symbol: "Diode:1N4148", footprint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", exactMpn: "1N4148" }, { refDes: "D2" }] });
    // the same start again attaches (a duplicate click starts nothing)
    expect(await chain.service.start(SCOPE, requester, { request: { componentIds: ["kc-d2", "kc-d1"], requirement: { mounting: "through_hole", packageCode: "DO-35" }, assetKinds: ["datasheet", "footprint", "symbol"] }, schematic: before, headMark: h.editor.headMark(), origin: "page" })).toMatchObject({ status: 202, body: { attached: true, task: { taskId } } });

    // ── 2. the worker's acquisition slice: local search, the fixture source, real bytes, validation, the stored candidate ──
    const first = await chain.runWorker();
    expect(first.slices.map((slice) => [slice.kind, slice.outcome])).toEqual([["acquire", "ended"]]);
    let task = view(await chain.service.read(SCOPE, taskId));
    expect(task).toMatchObject({ state: "awaiting-review", nextAction: "send-for-review", candidate: { verdict: "validated", sourceId: "fixture-kicad", fixtureEvidence: true, identity: { kind: "generic" } } });
    expect(task.stages.find((stage) => stage.stage === "local-search")!.evidence).toContain("no eligible local revision");
    expect(task.attempts.map((attempt) => [attempt.sourceId, attempt.outcome])).toEqual([["kicad-bundled", "skipped"], ["kicad-gitlab", "skipped"], ["fixture-kicad", "used"]]);
    expect(chain.transport.requests).toHaveLength(4);
    expect(task.candidate!.objects.map((object) => object.role)).toEqual(["symbol-file", "symbol-parent", "footprint", "datasheet", "symbol-library"]);
    expect(task.candidate!.objects.find((object) => object.role === "datasheet")!.sha256).toBe(sha256(PIN_TABLE_1N4148));
    expect(task.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["accepted", "worker_claimed", "local_search", "source_selected", "retrieved", "stored", "validated", "awaiting_handoff"]));
    // [PR-L/M integration, 2026-10-18] the stage waiting for a PERSON reads "awaiting" (it said "running" while nothing ran) and is the current stage
    expect(task.stages.find((stage) => stage.stage === "handoff")).toMatchObject({ status: "awaiting", evidence: "waiting for a person to send the package for component review" });
    expect(task.stage).toBe("handoff");

    // ── 3. a PERSON sends the package for review (the governance inbox in another scope) ──
    const sent = await chain.service.handoff(SCOPE, human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send-for-review-1" });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const handoffId = sent.body.handoffId as string;
    expect(view(sent)).toMatchObject({ nextAction: "await-publication", handoff: { handoffId } });
    expect(view(sent).stages.filter((stage) => stage.stage === "handoff" || stage.stage === "awaiting-publication").map((stage) => [stage.stage, stage.status])).toEqual([["handoff", "done"], ["awaiting-publication", "awaiting"]]); // [PR-L/M integration, 2026-10-18] two people review: awaiting, never "running"
    expect(view(sent).stage).toBe("awaiting-publication");
    const handoff = (await loadAcquisitionHandoff(chain.handoffDeps, handoffId))!;
    expect(JSON.stringify(handoff)).not.toContain(SCOPE.projectId); // the inbox learns nothing about the source project
    expect(handoff.package).toMatchObject({ links: [{ partId: catalog.ids.get("1n4148"), valueKey: "" }], discovery: false, terminalOrigin: "datasheet" });
    expect(handoff.package.spec).toMatchObject({ exactMpn: "1N4148", profile: "pcb_assignable", symbol: { library: "Diode", name: "1N4148", acquired: { handoffId } }, footprint: { library: "Diode_THT", name: "D_DO-35_SOD27_P7.62mm_Horizontal" }, terminals: [{ number: "1", function: "K", pads: ["1"] }, { number: "2", function: "A", pads: ["2"] }], package: { code: "DO-35", mounting: "through_hole" }, manufacturer: null });

    // ── 4. two humans in the governance project: submit + approve, then a DIFFERENT administrator publishes ──
    const deps = chain.publicationDeps(memberships);
    const approved = await submitAndApprove(deps, handoff.package.spec, handoff.package.links);
    const sourceClasses = new Map(approved.evidence.facts.map((fact) => [`${fact.property}:${fact.sourceId}`, fact.sourceClass]));
    expect(sourceClasses.get("symbol:source_cad_fixture_kicad")).toBe("official_kicad_library");
    expect(sourceClasses.get("pin_mapping:source_cad_fixture_pin_tables")).toBe("organization_authored"); // the fixture table, never a manufacturer datasheet
    expect(approved.evidence.conflicts).toEqual([]); // the person's terminal table equals the pin table
    const published = await publishBy(deps, approved.requestId);
    expect(published.request.status).toBe("published");
    const revisionId = published.request.publication!.revisionId;
    // the stored rows: the revision, the own part's link, the composed symbol's bytes, the pinned revision label, the approved mapping
    const [revision] = (await pg.db.query<{ id: string; publication_state: string }>("SELECT id, publication_state FROM atomic_part_revisions WHERE id = $1", [revisionId])).rows;
    expect(revision).toMatchObject({ id: revisionId, publication_state: "published" });
    expect((await pg.db.query<{ part_id: string; value_key: string; footprint_full_name: string }>("SELECT part_id, value_key, footprint_full_name FROM parts_atomic_links WHERE atomic_part_revision_id = $1", [revisionId])).rows).toEqual([{ part_id: catalog.ids.get("1n4148"), value_key: "", footprint_full_name: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal" }]);
    const symbolObject = handoff.symbolObject;
    expect((await pg.db.query<{ content_hash: string }>("SELECT content_hash FROM atomic_raw_objects WHERE content_hash = $1", [symbolObject])).rows).toHaveLength(1);
    expect((await pg.db.query<{ revision: string }>("SELECT revision FROM atomic_source_records WHERE source_id = 'source_cad_fixture_kicad' ORDER BY revision")).rows.map((row) => row.revision)).toEqual([`fixture:kicad-footprints@${KICAD_LIBRARY_PINS.footprints.commit}`, `fixture:kicad-symbols@${KICAD_LIBRARY_PINS.symbols.commit}`]);
    const certificate = (await pg.db.query<{ state: string; certificate: { evidenceIds: string[] } }>("SELECT state, certificate FROM atomic_mapping_certificates mc JOIN atomic_part_revisions r ON r.revision_data->'cadBundles'->0->>'mappingCertificateId' = mc.id WHERE r.id = $1", [revisionId])).rows[0]!;
    expect(certificate.state).toBe("approved");
    expect(certificate.certificate.evidenceIds).toHaveLength(2); // the person's table AND the pin table it equals

    // ── 5. the task re-checks: M1's candidate search finds the published revision eligible for both instances ──
    const recheck = await chain.service.control(SCOPE, requester, { taskId, action: "recheck", clientActionId: "check-again-1" });
    expect(recheck.status, JSON.stringify(recheck.body)).toBe(200);
    expect((await chain.runWorker()).slices.map((slice) => [slice.kind, slice.outcome])).toEqual([["recheck", "ended"]]);
    task = view(await chain.service.read(SCOPE, taskId));
    expect(task).toMatchObject({ state: "awaiting-review", nextAction: "offer-replacement", publication: { status: "published", revisionId }, proposal: { componentIds: ["kc-d1", "kc-d2"], candidatePartId: catalog.ids.get("1n4148"), atomicPartRevisionId: revisionId, origin: "own-part", reused: false } });

    // ── 6. M1's sealed batch over the offered revision; the human's reviewed apply: ONE transaction, a receipt, a new revision ──
    const sealed = await h.invoke("sirkit.schematic.propose-component-resolution", { items: task.proposal!.componentIds.map((componentId) => ({ componentId, candidatePartId: task.proposal!.candidatePartId, atomicPartRevisionId: task.proposal!.atomicPartRevisionId })) });
    expect(sealed.kind, JSON.stringify(sealed)).toBe("resolution-proposal");
    if (sealed.kind !== "resolution-proposal") return;
    expect(sealed.proposal.impact.items.map((item) => [item.refDes, item.mode, item.target.atomicPartRevisionId])).toEqual([["D1", "same-part-binding", revisionId], ["D2", "same-part-binding", revisionId]]);
    const applied = await apply(h, sealed.proposal);
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, status: "committed" }); // [PR-L/M integration, 2026-10-18] F10: a fresh apply must COMMIT (an "already-applied" answer here is a defect, never a silent skip of steps 6-7)
    if (!applied.ok || applied.status !== "committed") throw new Error("unreachable: the apply did not commit"); // narrows the type only
    const after = h.visible();
    expect(schematicStateDigest(after)).toBe(applied.receipt.schematicDigestAfter);
    for (const id of ["kc-d1", "kc-d2"]) expect(after.kicadComponents!.find((instance) => instance.id === id)).toMatchObject({ partId: catalog.ids.get("1n4148"), atomicPartRevisionId: revisionId });
    expect(await netsByFunction(after)).toEqual(netsBefore); // the electrical check: every net, its members and the polarity on it
    expect(buildPcbSyncPreflightReport(after)).toMatchObject({ unresolved: { count: 0 }, status: "ready_for_server_preparation" });

    // ── 7. the receipt and the updated preflight recorded on the task (the preflight recomputed by the server over the sheet sent) ──
    const recorded = await chain.service.recordApplied(SCOPE, requester, { taskId, clientActionId: "applied-1", receiptId: applied.receipt.receiptId, schematicDigestAfter: applied.receipt.schematicDigestAfter, schematic: after });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(view(recorded)).toMatchObject({ state: "succeeded", applied: { receiptId: applied.receipt.receiptId }, preflight: { unresolvedCount: 0 } });
    expect(view(recorded).stages.map((stage) => [stage.stage, stage.status])).toEqual([["local-search", "done"], ["source-selection", "done"], ["retrieve", "done"], ["validate", "done"], ["handoff", "done"], ["awaiting-publication", "done"], ["proposal", "done"], ["applied", "done"], ["preflight", "done"]]);
    // a stale or foreign record is refused: the receipt for a sheet the task did not offer
    expect((await chain.service.recordApplied(SCOPE, requester, { taskId, clientActionId: "applied-2", receiptId: "r-x", schematicDigestAfter: schematicStateDigest(before), schematic: before })).status).toBe(409);
    // [PR-L/M integration, 2026-10-18] M2-SEC-2: a SUCCEEDED task takes no other receipt (even over the same, valid sheet): 409, the recorded
    // receipt unchanged; the same receipt again (a retried click) stays the idempotent no-op
    const other = await chain.service.recordApplied(SCOPE, requester, { taskId, clientActionId: "applied-3", receiptId: "r-another-receipt", schematicDigestAfter: applied.receipt.schematicDigestAfter, schematic: after });
    expect(other).toMatchObject({ status: 409, body: { code: "COMPONENT_RESOLUTION_STATE_CONFLICT" } });
    const retried = await chain.service.recordApplied(SCOPE, requester, { taskId, clientActionId: "applied-4", receiptId: applied.receipt.receiptId, schematicDigestAfter: applied.receipt.schematicDigestAfter, schematic: after });
    expect(retried.status).toBe(200);
    expect(view(await chain.service.read(SCOPE, taskId))).toMatchObject({ state: "succeeded", applied: { receiptId: applied.receipt.receiptId } });

    // nothing paid, no model: zero embedding, zero reranker, and only the acquisition's four CAD requests
    expect(seams.embedded).toEqual([]);
    expect(seams.reranked).toBe(0);
    expect(chain.transport.requests).toHaveLength(4);
    void GOVERNANCE;
  });
});
